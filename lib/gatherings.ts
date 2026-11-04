import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from './config';
import { chapterNumber, cleanText, input, json, pageNumber } from './http';
import { requireOwner, requireUser, type User } from './auth';
import { audit, idempotent, rateLimit } from './persistence';
import { checkPoi, placeDto } from './places';

const include = { submitter: { include: { profile: true } }, dojo: true, temporaryPlace: true } as const;
export function gatheringDto(row: any, user: User | null) {
  return { id: row.id, chapter: row.chapterNumber, leadReader: row.leadReader, name: row.submitter.profile?.displayName || '共读者', avatar: row.submitter.profile?.avatar || 0, submittedAt: row.submittedAt, status: row.status, owned: !!user && (user.id === row.submitterId || user.role === 'ADMIN'), place: row.dojo?.status === 'PUBLISHED' ? placeDto(row.dojo, user) : row.temporaryPlace ? placeDto({ ...row.temporaryPlace, gathering: row }, user, true) : null };
}
export async function createGathering(request: Request, db: PrismaClient, user: User | null, now: Date) {
  const current = requireUser(user);
  const data = await input(request, z.object({ chapter: chapterNumber, leadReader: cleanText(160), leadReaderId: z.string().max(100).nullable().optional(), dojoId: z.string().max(100).nullable().optional(), poiToken: z.string().max(3000).nullable().optional(), publicConfirm: z.literal(true, { errorMap: () => ({ message: '请确认领读人姓名及所选地点会公开' }) }) }).strict());
  if (data.dojoId && data.poiToken) throw new ApiError(400, '请选择一种地点关联方式');
  const poi = data.poiToken ? checkPoi(data.poiToken, current.id, now) : null;
  await rateLimit(db, 'gathering-create', current.id, 20, 3600, now);
  const result = await idempotent(db, request, current.id, data, async tx => {
    if (data.dojoId && !(await tx.dojo.findFirst({ where: { id: data.dojoId, status: 'PUBLISHED' } }))) throw new ApiError(400, '所选道场不可用');
    let leadReader = data.leadReader;
    if (data.leadReaderId) {
      const account = await tx.account.findFirst({ where: { id: data.leadReaderId, active: true }, include: { profile: true } });
      if (!account?.profile) throw new ApiError(400, '领读人账号不可用'); leadReader = account.profile.displayName;
    }
    const row = await tx.gatheringSubmission.create({ data: { submitterId: current.id, chapterNumber: data.chapter, leadReader, leadReaderId: data.leadReaderId || null, dojoId: data.dojoId || null, submittedAt: now, ...(poi ? { temporaryPlace: { create: { name: poi.name, address: poi.address, province: poi.province, city: poi.city, district: poi.district, longitude: poi.longitude, latitude: poi.latitude, poiId: poi.id } } } : {}) } });
    await audit(tx, current.id, 'GATHERING_CREATED', row.id);
    return { id: row.id };
  });
  return json(result, 201);
}
export async function getGathering(db: PrismaClient, id: string, user: User | null) {
  const row = await db.gatheringSubmission.findUnique({ where: { id }, include });
  if (!row || row.status === 'DELETED' || (row.status !== 'PUBLISHED' && row.submitterId !== user?.id && user?.role !== 'ADMIN')) throw new ApiError(404, '共读记录不存在或已停止公开');
  return gatheringDto(row, user);
}
export async function listGatherings(db: PrismaClient, user: User | null, params = new URLSearchParams()) {
  const current = requireUser(user);
  const rows = await db.gatheringSubmission.findMany({ where: { submitterId: current.id, status: { not: 'DELETED' } }, include, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: pageNumber(params) * 20, take: 21 });
  return { gatherings: rows.slice(0, 20).map(row => gatheringDto(row, current)), hasMore: rows.length > 20 };
}
export async function updateGathering(request: Request, db: PrismaClient, id: string, user: User | null, now: Date) {
  const current = requireUser(user);
  const data = await input(request, z.object({ status: z.enum(['PUBLISHED', 'HIDDEN', 'DELETED']).optional(), leadReader: cleanText(160).optional(), poiToken: z.string().max(3000).optional() }).strict());
  const poi = data.poiToken ? checkPoi(data.poiToken, current.id, now) : null;
  await db.$transaction(async tx => {
    const row = await tx.gatheringSubmission.findUnique({ where: { id }, include: { temporaryPlace: true } });
    if (!row) throw new ApiError(404, '记录不存在'); requireOwner(current, row.submitterId);
    if (row.status === 'DELETED') throw new ApiError(409, '已删除的记录不能恢复');
    await tx.gatheringSubmission.update({ where: { id }, data: { ...(data.status ? { status: data.status } : {}), ...(data.leadReader ? { leadReader: data.leadReader, leadReaderId: null } : {}), ...(poi ? { dojoId: null, temporaryPlace: { upsert: { create: { name: poi.name, address: poi.address, province: poi.province, city: poi.city, district: poi.district, longitude: poi.longitude, latitude: poi.latitude, poiId: poi.id }, update: { name: poi.name, address: poi.address, province: poi.province, city: poi.city, district: poi.district, longitude: poi.longitude, latitude: poi.latitude, poiId: poi.id } } } } : {}) } });
    await audit(tx, current.id, 'GATHERING_UPDATED', id, { status: data.status || row.status });
  });
  return json({ ok: true });
}
