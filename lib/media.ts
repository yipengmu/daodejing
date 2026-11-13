import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { parseBuffer } from 'music-metadata';
import { ApiError } from './config';
import { input, json } from './http';
import { requireUser, type User } from './auth';
import { databaseStorageEnabled, localStorageEnabled, objectSize, readObject, uploadUrl, writeObject } from './providers/storage';
import { rateLimit } from './persistence';

export const mediaFormats: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const mediaChunkSize = 2 * 1024 * 1024;
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
  const local = localStorageEnabled(); const database = databaseStorageEnabled(); const target = local || database ? null : await uploadUrl(objectKey, data.mime);
  const asset = await db.mediaAsset.create({ data: { ownerId: current.id, objectKey, mime: data.mime, size: data.size } });
  return json({ id: asset.id, uploadUrl: target || `/api/media/${asset.id}/upload`, mime: data.mime, method: 'PUT', ...(database ? { chunkSize: mediaChunkSize } : {}) }, 201);
}
export async function localUpload(request: Request, db: PrismaClient, id: string, user: User | null) {
  const current = requireUser(user); const database = databaseStorageEnabled(); if (!localStorageEnabled() && !database) throw new ApiError(404, '上传地址不可用');
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.ownerId !== current.id || asset.status !== 'PENDING') throw new ApiError(403, '文件上传权限无效');
  const data = Buffer.from(await request.arrayBuffer());
  if (database) {
    const rawOffset = new URL(request.url).searchParams.get('offset');
    if (!rawOffset || !/^\d+$/.test(rawOffset)) throw new ApiError(400, '缺少上传位置');
    const offset = Number(rawOffset);
    if (!Number.isSafeInteger(offset) || data.length < 1 || data.length > mediaChunkSize || offset + data.length > asset.size) throw new ApiError(400, '上传分块无效');
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.mediaBlob.findUnique({ where: { mediaId: id } });
      const previous = existing ? Buffer.from(existing.data) : Buffer.alloc(0);
      if (previous.length !== offset) throw new ApiError(409, '上传位置已改变，请重新上传');
      const combined = Buffer.concat([previous, data]);
      await tx.mediaBlob.upsert({ where: { mediaId: id }, create: { mediaId: id, data: combined }, update: { data: combined } });
    });
    return json({ ok: true, received: offset + data.length });
  }
  if (data.length !== asset.size || data.length > mediaLimit(asset.mime)) throw new ApiError(400, '文件大小与申报不一致');
  await writeObject(asset.objectKey, data, asset.mime); return json({ ok: true });
}
export async function completeUpload(db: PrismaClient, id: string, user: User | null) {
  const current = requireUser(user); const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.ownerId !== current.id || asset.status === 'DELETED' || asset.status === 'HIDDEN') throw new ApiError(403, '附件不可用');
  if (asset.status === 'READY') return json({ id, mime: asset.mime });
  const blob = await db.mediaBlob.findUnique({ where: { mediaId: id } });
  if (databaseStorageEnabled()) {
    if (!blob || blob.data.length !== asset.size) throw new ApiError(400, '上传不完整或文件大小不一致');
    const sanitized = await sanitizeMedia(Buffer.from(blob.data), asset.mime);
    if (sanitized.length > mediaLimit(asset.mime)) throw new ApiError(400, '处理后的文件过大');
    await db.$transaction([db.mediaBlob.update({ where: { mediaId: id }, data: { data: Uint8Array.from(sanitized) } }), db.mediaAsset.update({ where: { id }, data: { size: sanitized.length, status: 'READY' } })]);
    return json({ id, mime: asset.mime });
  }
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
  const object = await databaseMediaResponse(db, id, request.headers.get('range'), request.method === 'HEAD') || await readObject(asset.objectKey, request.headers.get('range'));
  if (!object.ok && object.status !== 416) throw new ApiError(502, '媒体暂时无法读取');
  const headers = new Headers({ 'Content-Type': asset.mime, 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="${id}.${mediaFormats[asset.mime]}"`, 'Accept-Ranges': 'bytes' });
  for (const key of ['content-length', 'content-range']) { const value = object.headers.get(key); if (value) headers.set(key, value); }
  return new Response(request.method === 'HEAD' ? null : object.body, { status: object.status, headers });
}

async function databaseMediaResponse(db: PrismaClient, id: string, range: string | null, head: boolean): Promise<Response | null> {
  const rows = await db.$queryRaw<Array<{ size: number }>>`SELECT octet_length(data)::integer AS size FROM "MediaBlob" WHERE "mediaId" = ${id}`;
  if (!rows.length) return null;
  const size = rows[0].size;
  const headers = new Headers({ 'Accept-Ranges': 'bytes' });
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    else start = Math.max(0, size - Number(match[2]));
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  end = Math.min(end, start + mediaChunkSize - 1);
  const partial = !!range || end < size - 1;
  headers.set('Content-Length', String(end - start + 1));
  if (partial) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  if (head) return new Response(null, { status: partial ? 206 : 200, headers });
  const chunks = await db.$queryRaw<Array<{ part: Uint8Array }>>`SELECT substring(data from ${start + 1} for ${end - start + 1}) AS part FROM "MediaBlob" WHERE "mediaId" = ${id}`;
  if (!chunks.length) throw new ApiError(404, '媒体不存在');
  return new Response(Uint8Array.from(chunks[0].part), { status: partial ? 206 : 200, headers });
}
