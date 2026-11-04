import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { parseBuffer } from 'music-metadata';
import { ApiError } from './config';
import { input, json } from './http';
import { requireUser, type User } from './auth';
import { localStorageEnabled, objectSize, readObject, uploadUrl, writeObject } from './providers/storage';
import { rateLimit } from './persistence';

export const mediaFormats: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
export function mediaLimit(mime: string) { return mime.startsWith('image/') ? 8 * 1024 * 1024 : 20 * 1024 * 1024; }
function cleanMp3(buffer: Buffer) {
  let start = 0, end = buffer.length;
  while (buffer.subarray(start, start + 3).toString() === 'ID3' && start + 10 <= end) {
    const size = ((buffer[start + 6] & 127) << 21) | ((buffer[start + 7] & 127) << 14) | ((buffer[start + 8] & 127) << 7) | (buffer[start + 9] & 127);
    start += 10 + size + (buffer[start + 5] & 16 ? 10 : 0);
  }
  if (buffer.subarray(end - 128, end - 125).toString() === 'TAG') end -= 128;
  if (end >= 32 && buffer.subarray(end - 32, end - 24).toString() === 'APETAGEX') end -= buffer.readUInt32LE(end - 20);
  if (start >= end) throw new ApiError(400, '音频文件格式不正确');
  return buffer.subarray(start, end);
}
function cleanWav(buffer: Buffer) {
  if (buffer.subarray(0, 4).toString() !== 'RIFF' || buffer.subarray(8, 12).toString() !== 'WAVE') throw new ApiError(400, 'WAV 文件格式不正确');
  const chunks: Buffer[] = []; let offset = 12;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4), end = offset + 8 + size + size % 2;
    if (end > buffer.length) throw new ApiError(400, '音频文件不完整');
    if (['fmt ', 'data', 'fact'].includes(buffer.subarray(offset, offset + 4).toString())) chunks.push(buffer.subarray(offset, end));
    offset = end;
  }
  const head = Buffer.from(buffer.subarray(0, 12)); head.writeUInt32LE(chunks.reduce((sum, value) => sum + value.length, 4), 4);
  return Buffer.concat([head, ...chunks]);
}
export async function sanitizeMedia(data: Buffer, mime: string): Promise<Buffer> {
  if (mime.startsWith('image/')) {
    try {
      const image = sharp(data, { limitInputPixels: 40_000_000 }); const metadata = await image.metadata();
      const expected = mediaFormats[mime] === 'jpg' ? 'jpeg' : mediaFormats[mime];
      if (metadata.format !== expected) throw new Error();
      return await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).toFormat(expected as 'jpeg' | 'png' | 'webp').toBuffer();
    } catch { throw new ApiError(400, '图片格式不正确或尺寸过大'); }
  }
  const cleaned = mime === 'audio/mpeg' ? cleanMp3(data) : cleanWav(data);
  try {
    const metadata = await parseBuffer(cleaned, { mimeType: mime }, { duration: true });
    if (!metadata.format.duration || metadata.format.duration > 600 || metadata.format.duration <= 0) throw new Error();
    if (mime === 'audio/mpeg' && !metadata.format.container?.toLowerCase().includes('mpeg')) throw new Error();
    if (Object.keys(metadata.common).some(key => !['track', 'disk', 'movementIndex'].includes(key))) throw new Error();
    return cleaned;
  } catch { throw new ApiError(400, '请使用不超过 10 分钟的 MP3 或 WAV 音频'); }
}
export async function beginUpload(request: Request, db: PrismaClient, user: User | null, now: Date) {
  const current = requireUser(user); const data = await input(request, z.object({ mime: z.string().refine(value => value in mediaFormats, '支持 JPG、PNG、WebP、MP3 和 WAV'), size: z.number().int().positive() }).strict());
  if (data.size > mediaLimit(data.mime)) throw new ApiError(400, data.mime.startsWith('image/') ? '图片不能超过 8 MB' : '音频不能超过 20 MB');
  await rateLimit(db, 'media-upload', current.id, 30, 3600, now);
  const objectKey = `users/${current.id}/${randomUUID()}.${mediaFormats[data.mime]}`;
  const local = localStorageEnabled(); const target = local ? null : await uploadUrl(objectKey, data.mime);
  const asset = await db.mediaAsset.create({ data: { ownerId: current.id, objectKey, mime: data.mime, size: data.size } });
  return json({ id: asset.id, uploadUrl: target || `/api/media/${asset.id}/upload`, mime: data.mime, method: 'PUT' }, 201);
}
export async function localUpload(request: Request, db: PrismaClient, id: string, user: User | null) {
  const current = requireUser(user); if (!localStorageEnabled()) throw new ApiError(404, '上传地址不可用');
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.ownerId !== current.id || asset.status !== 'PENDING') throw new ApiError(403, '文件上传权限无效');
  const data = Buffer.from(await request.arrayBuffer());
  if (data.length !== asset.size || data.length > mediaLimit(asset.mime)) throw new ApiError(400, '文件大小与申报不一致');
  await writeObject(asset.objectKey, data, asset.mime); return json({ ok: true });
}
export async function completeUpload(db: PrismaClient, id: string, user: User | null) {
  const current = requireUser(user); const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.ownerId !== current.id || asset.status === 'DELETED' || asset.status === 'HIDDEN') throw new ApiError(403, '附件不可用');
  if (asset.status === 'READY') return json({ id, mime: asset.mime });
  if (await objectSize(asset.objectKey) !== asset.size) throw new ApiError(400, '上传不完整或文件大小不一致');
  const object = await readObject(asset.objectKey); if (!object.ok) throw new ApiError(400, '无法验证文件');
  const sanitized = await sanitizeMedia(Buffer.from(await object.arrayBuffer()), asset.mime);
  if (sanitized.length > mediaLimit(asset.mime)) throw new ApiError(400, '处理后的文件过大');
  await writeObject(asset.objectKey, sanitized, asset.mime);
  await db.mediaAsset.update({ where: { id }, data: { size: sanitized.length, status: 'READY' } });
  return json({ id, mime: asset.mime });
}
export async function serveMedia(request: Request, db: PrismaClient, id: string, user: User | null) {
  const asset = await db.mediaAsset.findUnique({ where: { id }, include: { content: true } });
  const published = asset?.content?.status === 'PUBLISHED';
  const ownUnpublished = asset && !asset.contentId && user?.id === asset.ownerId;
  if (!asset || asset.status !== 'READY' || (!published && !ownUnpublished)) throw new ApiError(404, '媒体不存在或已停止公开');
  const object = await readObject(asset.objectKey, request.headers.get('range'));
  if (!object.ok && object.status !== 416) throw new ApiError(502, '媒体暂时无法读取');
  const headers = new Headers({ 'Content-Type': asset.mime, 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="${id}.${mediaFormats[asset.mime]}"`, 'Accept-Ranges': 'bytes' });
  for (const key of ['content-length', 'content-range']) { const value = object.headers.get(key); if (value) headers.set(key, value); }
  return new Response(request.method === 'HEAD' ? null : object.body, { status: object.status, headers });
}
