import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { digest, equalDigest } from '@daodejing/auth-kit';
import { ApiError, required } from './config';
import { chapterNumber, cleanText, input, json, safeUrl, pageNumber } from './http';
import { requireOwner, requireUser, type User } from './auth';
import { audit, idempotent, rateLimit, shanghaiDay, type Db } from './persistence';

const shareInclude = { _count: { select: { likes: true, comments: { where: { status: 'PUBLISHED' } } } }, media: { where: { status: 'READY' } }, dojo: true, gathering: { include: { dojo: true, temporaryPlace: true } } } as const;
export function shareDto(row: any, user: User | null, liked = false) {
  return { id: row.id, chapter: row.chapterNumber, title: row.title, body: row.body, anonymous: row.anonymous, name: row.anonymous ? '一位共读者' : row.publicName, avatar: row.anonymous ? 0 : row.publicAvatar, createdAt: row.createdAt, updatedAt: row.updatedAt, views: row.viewsCount, likes: row._count?.likes || 0, comments: row._count?.comments || 0, liked, owned: !!user && (row.authorId === user.id || user.role === 'ADMIN'), status: row.status, sourceUrl: row.sourceUrl, gatheringId: row.gatheringId, placeName: (row.dojo?.status === 'PUBLISHED' ? row.dojo.name : null) || (row.gathering?.status === 'PUBLISHED' ? (row.gathering.dojo?.status === 'PUBLISHED' ? row.gathering.dojo.name : row.gathering.temporaryPlace?.name) : null) || null, media: (row.media || []).map((m: any) => ({ id: m.id, mime: m.mime, name: m.mime.startsWith('image/') ? '分享图片' : '分享音频' })) };
}
async function readable(db: Db, id: string, user: User | null, publicOnly = false) {
  const row = await db.contentItem.findUnique({ where: { id }, include: shareInclude });
  if (!row || row.status === 'DELETED' || (row.status !== 'PUBLISHED' && (publicOnly || !(user?.id === row.authorId || user?.role === 'ADMIN')))) throw new ApiError(404, '分享不存在或已停止公开');
  return row;
}
export async function listShares(db: PrismaClient, user: User | null, params: URLSearchParams, mine = false) {
  if (mine) requireUser(user);
  const chapter = params.get('chapter') ? chapterNumber.parse(params.get('chapter')) : undefined;
  const page = pageNumber(params);
  const where = { ...(chapter ? { chapterNumber: chapter } : {}), ...(mine ? { authorId: user!.id, status: { not: 'DELETED' } } : { status: 'PUBLISHED' }) };
  const rows = await db.contentItem.findMany({ where, include: shareInclude, orderBy: params.get('sort') === 'latest' ? [{ createdAt: 'desc' }, { id: 'desc' }] : [{ viewsCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], skip: page * 20, take: 21 });
  return { shares: rows.slice(0, 20).map(row => shareDto(row, user)), hasMore: rows.length > 20 };
}
export function readTicket(id: string, visitor: string, now: Date) {
  const payload = Buffer.from(JSON.stringify({ id, visitor, at: now.getTime() })).toString('base64url');
  return `${payload}.${digest(required('IDENTITY_HMAC_SECRET'), payload)}`;
}
function checkReadTicket(ticket: string, id: string, visitor: string, now: Date) {
  try {
    const [data, signature] = ticket.split('.');
    if (!signature || !equalDigest(signature, digest(required('IDENTITY_HMAC_SECRET'), data))) throw new Error();
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString());
    const elapsed = now.getTime() - parsed.at;
    if (parsed.id !== id || parsed.visitor !== visitor || elapsed < 5000 || elapsed > 1800000) throw new Error();
  } catch { throw new ApiError(400, '阅读记录无效，请重新打开分享', 'INVALID_READ_EVENT'); }
}
export async function getShare(db: PrismaClient, id: string, user: User | null, visitor: string, now: Date) {
  const row = await readable(db, id, user);
  const like = user ? await db.contentLike.findUnique({ where: { contentId_accountId: { contentId: id, accountId: user.id } } }) : null;
  return { ...shareDto(row, user, !!like), readTicket: row.status === 'PUBLISHED' ? readTicket(id, visitor, now) : null };
}
const shareInput = z.object({ chapter: chapterNumber, title: z.string().trim().max(120).default(''), body: cleanText(12000), anonymous: z.boolean().default(false), publicName: z.string().trim().max(80).optional(), sourceUrl: safeUrl.default(''), gatheringId: z.string().max(100).nullable().optional(), dojoId: z.string().max(100).nullable().optional(), mediaIds: z.array(z.string().max(100)).max(6).default([]), acknowledge: z.literal(true, { errorMap: () => ({ message: '请确认公开范围与媒体告知' }) }) }).strict();
export async function createShare(request: Request, db: PrismaClient, user: User | null, now: Date) {
  const current = requireUser(user); const data = await input(request, shareInput);
  await rateLimit(db, 'share-create', current.id, 15, 3600, now);
  const result = await idempotent(db, request, current.id, data, async tx => {
    if (data.gatheringId) {
      const gathering = await tx.gatheringSubmission.findUnique({ where: { id: data.gatheringId } });
      if (!gathering || gathering.chapterNumber !== data.chapter || gathering.status !== 'PUBLISHED' || (gathering.submitterId !== current.id && current.role !== 'ADMIN')) throw new ApiError(400, '只能关联同章节、由本人提交的公开共读记录');
    }
    if (data.dojoId && !(await tx.dojo.findFirst({ where: { id: data.dojoId, status: 'PUBLISHED' } }))) throw new ApiError(400, '关联道场不可用');
    const ids = [...new Set(data.mediaIds)];
    if (ids.length !== data.mediaIds.length) throw new ApiError(400, '请勿重复添加同一个附件');
    const row = await tx.contentItem.create({ data: { authorId: current.id, chapterNumber: data.chapter, title: data.title, body: data.body, anonymous: data.anonymous, publicName: data.anonymous ? '一位共读者' : data.publicName || current.profile?.displayName || '共读者', publicAvatar: data.anonymous ? 0 : current.profile?.avatar || 0, sourceUrl: data.sourceUrl || null, gatheringId: data.gatheringId || null, dojoId: data.dojoId || null, createdAt: now } });
    if (ids.length) {
      const media = await tx.mediaAsset.updateMany({ where: { id: { in: ids }, ownerId: current.id, contentId: null, status: 'READY' }, data: { contentId: row.id } });
      if (media.count !== ids.length) throw new ApiError(400, '附件不可用、尚未完成上传或已用于其他分享');
    }
    await audit(tx, current.id, 'SHARE_PUBLISHED', row.id, { acknowledgementVersion: 'publication-v1' });
    return { id: row.id };
  });
  return json(result, 201);
}
export async function updateShare(request: Request, db: PrismaClient, id: string, user: User | null) {
  const current = requireUser(user);
  const data = await input(request, z.object({ status: z.enum(['PUBLISHED', 'HIDDEN', 'DELETED']).optional(), title: z.string().trim().max(120).optional(), body: cleanText(12000).optional() }).strict());
  await db.$transaction(async tx => {
    const item = await tx.contentItem.findUnique({ where: { id } }); if (!item) throw new ApiError(404, '分享不存在');
    requireOwner(current, item.authorId);
    if (item.status === 'DELETED') throw new ApiError(409, '已删除的分享不能恢复');
    await tx.contentItem.update({ where: { id }, data });
    await audit(tx, current.id, 'SHARE_UPDATED', id, { status: data.status || item.status });
  });
  return json({ ok: true });
}
export async function recordRead(request: Request, db: PrismaClient, id: string, user: User | null, visitor: string, now: Date) {
  const { ticket } = await input(request, z.object({ ticket: cleanText(2000) }));
  checkReadTicket(ticket, id, visitor, now);
  await rateLimit(db, 'read', visitor, 300, 3600, now);
  const readDay = shanghaiDay(now); const readerKey = digest(required('IDENTITY_HMAC_SECRET'), user ? `account:${user.id}` : `guest:${visitor}`);
  const count = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${id} FOR UPDATE`;
    const item = await readable(tx, id, user, true);
    const previous = await tx.contentView.findMany({ where: { contentId: id, readDay, OR: [{ readerKey }, { visitorHash: visitor }] } });
    if (!previous.length) {
      await tx.contentView.create({ data: { contentId: id, readerKey, visitorHash: visitor, readDay, createdAt: now } });
      return (await tx.contentItem.update({ where: { id }, data: { viewsCount: { increment: 1 } } })).viewsCount;
    }
    if (user) {
      const canonical = previous.find(row => row.readerKey === readerKey) || previous[0];
      if (previous.length > 1) {
        await tx.contentView.deleteMany({ where: { id: { in: previous.filter(x => x.id !== canonical.id).map(x => x.id) } } });
        await tx.contentItem.update({ where: { id }, data: { viewsCount: { decrement: previous.length - 1 } } });
      }
      if (canonical.readerKey !== readerKey) await tx.contentView.update({ where: { id: canonical.id }, data: { readerKey } });
    }
    return item.viewsCount - Math.max(0, previous.length - 1);
  });
  return json({ views: count });
}
export async function recordExposure(db: PrismaClient, id: string, visitor: string, now: Date) {
  await readable(db, id, null, true);
  await db.exposure.upsert({ where: { contentId_visitorHash_readDay: { contentId: id, visitorHash: visitor, readDay: shanghaiDay(now) } }, create: { contentId: id, visitorHash: visitor, readDay: shanghaiDay(now), createdAt: now }, update: {} });
  return json({ ok: true });
}
export async function setLike(request: Request, db: PrismaClient, id: string, user: User | null, now: Date) {
  const current = requireUser(user); const data = await input(request, z.object({ liked: z.boolean() }));
  await rateLimit(db, 'like', current.id, 120, 3600, now);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${id} FOR UPDATE`;
    await readable(tx, id, current, true);
    if (data.liked) await tx.contentLike.upsert({ where: { contentId_accountId: { contentId: id, accountId: current.id } }, create: { contentId: id, accountId: current.id }, update: {} });
    else await tx.contentLike.deleteMany({ where: { contentId: id, accountId: current.id } });
  });
  return json({ liked: data.liked, likes: await db.contentLike.count({ where: { contentId: id } }) });
}
export async function comments(request: Request, db: PrismaClient, id: string, user: User | null, now: Date) {
  await readable(db, id, user, true);
  if (request.method === 'GET') {
    const page = pageNumber(new URL(request.url).searchParams);
    const rows = await db.contentComment.findMany({ where: { contentId: id, status: 'PUBLISHED' }, include: { author: { include: { profile: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51, skip: page * 50 });
    return json({ comments: rows.slice(0, 50).map(row => ({ id: row.id, body: row.body, name: row.author.profile?.displayName || '共读者', avatar: row.author.profile?.avatar || 0, createdAt: row.createdAt, owned: !!user && (row.authorId === user.id || user.role === 'ADMIN') })), hasMore: rows.length > 50 });
  }
  const current = requireUser(user); const data = await input(request, z.object({ body: cleanText(2000) }).strict());
  await rateLimit(db, 'comment-minute', current.id, 5, 60, now);
  await rateLimit(db, 'comment-day', current.id, 60, 86400, now);
  return json(await idempotent(db, request, current.id, data, async tx => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${id} FOR UPDATE`;
    await readable(tx, id, current, true);
    const row = await tx.contentComment.create({ data: { contentId: id, authorId: current.id, body: data.body, createdAt: now } });
    return { id: row.id };
  }), 201);
}
