import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { digest, equalDigest } from '@daodejing/auth-kit';
import { ApiError, required } from './config';
import { cleanText, input, json, safeUrl } from './http';
import { requireUser, requireOwner, type User } from './auth';
import { audit, idempotent, rateLimit } from './persistence';

export const poiSchema = z.object({ id: cleanText(100), name: cleanText(160), address: cleanText(300), province: cleanText(80), city: cleanText(80), district: z.string().max(80), longitude: z.number().min(73).max(136), latitude: z.number().min(3).max(54) });
export type Poi = z.infer<typeof poiSchema>;
export function signPoi(poi: Poi, actor: string, now: Date) {
  const payload = Buffer.from(JSON.stringify({ poi, actor, expires: now.getTime() + 1800000 })).toString('base64url');
  return `${payload}.${digest(required('IDENTITY_HMAC_SECRET'), payload)}`;
}
export function checkPoi(token: string, actor: string, now: Date): Poi {
  try {
    const [data, signature] = token.split('.');
    if (!signature || !equalDigest(signature, digest(required('IDENTITY_HMAC_SECRET'), data))) throw new Error();
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.actor !== actor || payload.expires < now.getTime()) throw new Error();
    return poiSchema.parse(payload.poi);
  } catch { throw new ApiError(400, '地点选择已失效，请重新选择有效 POI'); }
}
export function placeDto(row: any, user: User | null, temporary = false) {
  const confirmed = temporary || row.poiConfirmed;
  return { id: row.id, type: temporary ? 'TEMPORARY' : 'FIXED', name: row.name, province: row.province, city: row.city, district: row.district, address: row.address, description: temporary ? '由到场共读者提交的临时地点，请以记录中的实际信息为准。' : row.description, schedule: temporary ? null : row.schedule, welcome: temporary ? null : row.welcome, contact: temporary ? null : row.publicContact, signupUrl: temporary ? null : row.signupUrl, longitude: confirmed ? row.longitude : null, latitude: confirmed ? row.latitude : null, crs: row.crs, poiId: confirmed ? (temporary ? row.poiId : row.poiId) : null, poiName: temporary ? row.name : row.poiName, navigationQuery: temporary ? `${row.city}${row.address} ${row.name}` : row.navigationQuery || `${row.city}${row.address} ${row.name}`, owned: !!user && (user.role === 'ADMIN' || (temporary ? row.gathering?.submitterId === user.id : row.ownerId === user.id)), updatedAt: row.updatedAt, ...(temporary ? { gatheringId: row.gatheringId } : {}) };
}
export async function listPlaces(db: PrismaClient, user: User | null, search: URLSearchParams) {
  const where = { status: 'PUBLISHED', ...(search.get('province') ? { province: search.get('province')! } : {}), ...(search.get('city') ? { city: search.get('city')! } : {}) };
  const [fixed, temporary] = await Promise.all([
    db.dojo.findMany({ where, orderBy: [{ city: 'asc' }, { name: 'asc' }], take: 200 }),
    db.temporaryPlace.findMany({ where: { gathering: { status: 'PUBLISHED' }, ...(where.province ? { province: where.province } : {}), ...(where.city ? { city: where.city } : {}) }, include: { gathering: true }, orderBy: { updatedAt: 'desc' }, take: 200 }),
  ]);
  return { places: [...fixed.map(x => placeDto(x, user)), ...temporary.map(x => placeDto(x, user, true))] };
}
export async function searchPoi(query: string, user: User, now: Date) {
  const key = process.env.AMAP_REST_KEY;
  if (!key) throw new ApiError(503, '地点搜索暂不可用，仍可不附地点继续提交', 'MAP_UNAVAILABLE');
  const url = new URL('https://restapi.amap.com/v3/place/text');
  url.search = new URLSearchParams({ key, keywords: query, city: '杭州', citylimit: 'false', offset: '8', extensions: 'base' }).toString();
  const result = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await result.json() as any;
  if (data.status !== '1') throw new ApiError(502, '地点搜索暂不可用，仍可不附地点继续提交');
  return { places: (data.pois || []).flatMap((item: any) => {
    const coordinates = String(item.location).split(',').map(Number);
    const parsed = poiSchema.safeParse({ id: item.id, name: item.name, address: typeof item.address === 'string' && item.address ? item.address : item.name, province: item.pname || '浙江省', city: typeof item.cityname === 'string' && item.cityname ? item.cityname : item.pname, district: typeof item.adname === 'string' ? item.adname : '', longitude: coordinates[0], latitude: coordinates[1] });
    return parsed.success ? [{ ...parsed.data, token: signPoi(parsed.data, user.id, now) }] : [];
  }) };
}
export async function nearbyPoi(longitude: number, latitude: number, user: User, now: Date) {
  const key = process.env.AMAP_REST_KEY;
  if (!key) throw new ApiError(503, '地点搜索暂不可用，仍可不附地点继续提交', 'MAP_UNAVAILABLE');
  const convert = new URL('https://restapi.amap.com/v3/assistant/coordinate/convert');
  convert.search = new URLSearchParams({ key, locations: `${longitude},${latitude}`, coordsys: 'gps' }).toString();
  const converted = await (await fetch(convert, { signal: AbortSignal.timeout(8000) })).json() as any;
  if (converted.status !== '1' || typeof converted.locations !== 'string' || !/^[\d.]+,[\d.]+$/.test(converted.locations)) throw new ApiError(502, '未能匹配当前位置，可搜索或不附地点继续');
  const url = new URL('https://restapi.amap.com/v3/place/around');
  url.search = new URLSearchParams({ key, location: converted.locations, radius: '1000', offset: '8', extensions: 'base', sortrule: 'distance' }).toString();
  const data = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json() as any;
  if (data.status !== '1') throw new ApiError(502, '附近地点暂时不可用，可不附地点继续');
  return { places: (data.pois || []).flatMap((item: any) => {
    const [lon, lat] = String(item.location).split(',').map(Number);
    const parsed = poiSchema.safeParse({ id: item.id, name: item.name, address: typeof item.address === 'string' && item.address ? item.address : item.name, province: item.pname || '浙江省', city: typeof item.cityname === 'string' && item.cityname ? item.cityname : item.pname || '杭州市', district: typeof item.adname === 'string' ? item.adname : '', longitude: lon, latitude: lat });
    return parsed.success ? [{ ...parsed.data, token: signPoi(parsed.data, user.id, now) }] : [];
  }) };
}

export async function proxyAmap(request: Request) {
  const source = new URL(request.url);
  const path = source.pathname.replace(/^\/api\/amap\/_AMapService/, '');
  const key = process.env.AMAP_WEB_KEY; const securityCode = process.env.AMAP_SECURITY_JSCODE;
  if (!key || !securityCode) throw new ApiError(503, '地图暂时无法加载', 'MAP_UNAVAILABLE');
  if (source.searchParams.get('key') !== key || !/^\/(?:v3\/[a-zA-Z0-9/_-]+|v4\/map\/styles)$/.test(path)) throw new ApiError(403, '地图请求无效');
  const target = new URL(path, path === '/v4/map/styles' ? 'https://webapi.amap.com' : 'https://restapi.amap.com');
  target.search = source.search; target.searchParams.set('jscode', securityCode);
  const result = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  return new Response(result.body, { status: result.status, headers: { 'Content-Type': result.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export async function getPlace(db: PrismaClient, id: string, user: User | null, type: string | null) {
  if (type === 'TEMPORARY') {
    const place = await db.temporaryPlace.findUnique({ where: { id }, include: { gathering: true } });
    if (!place || (place.gathering.status !== 'PUBLISHED' && user?.role !== 'ADMIN' && user?.id !== place.gathering.submitterId)) throw new ApiError(404, '地点不存在或已停止公开');
    return placeDto(place, user, true);
  }
  const place = await db.dojo.findUnique({ where: { id } });
  if (!place || (place.status !== 'PUBLISHED' && user?.role !== 'ADMIN' && user?.id !== place.ownerId)) throw new ApiError(404, '道场不存在或已停止公开');
  return placeDto(place, user);
}
export const dojoInput = z.object({ name: cleanText(160), address: cleanText(300), province: cleanText(80).default('浙江省'), city: cleanText(80).default('杭州市'), district: z.string().max(80).default(''), description: z.string().trim().max(2000).default(''), schedule: z.string().trim().max(300).default(''), welcome: z.boolean().default(true), publicContact: z.string().trim().max(300).default(''), signupUrl: safeUrl.default(''), poiToken: z.string().max(3000).optional(), publicConfirm: z.literal(true, { errorMap: () => ({ message: '请确认地点地址和填写的联系方式可以公开' }) }) }).strict();
export async function saveDojo(request: Request, db: PrismaClient, user: User | null, now: Date, id?: string) {
  const current = requireUser(user);
  const data = await input(request, dojoInput);
  const { poiToken, publicConfirm: _, ...fields } = data;
  const poi = poiToken ? checkPoi(poiToken, current.id, now) : null;
  await rateLimit(db, 'dojo-write', current.id, 10, 3600, now);
  const mapped = { ...fields, ...(poi ? { poiId: poi.id, poiName: poi.name, longitude: poi.longitude, latitude: poi.latitude, crs: 'GCJ-02', poiConfirmed: true } : {}), navigationQuery: `${fields.city}${fields.address} ${fields.name}` };
  const work = async (tx: any) => {
    let resetPoi = false;
    if (id) { const previous = await tx.dojo.findUnique({ where: { id } }); if (!previous) throw new ApiError(404, '道场不存在'); requireOwner(current, previous.ownerId); resetPoi = !poi && (previous.address !== fields.address || previous.name !== fields.name || previous.city !== fields.city); }
    const row = id ? await tx.dojo.update({ where: { id }, data: { ...mapped, ...(resetPoi ? { poiId: null, poiName: null, longitude: null, latitude: null, poiConfirmed: false } : {}) } }) : await tx.dojo.create({ data: { ...mapped, ownerId: current.id } });
    await audit(tx, current.id, id ? 'DOJO_UPDATED' : 'DOJO_CREATED', row.id);
    return placeDto(row, current);
  };
  return json(id ? await db.$transaction(work) : await idempotent(db, request, current.id, data, work), id ? 200 : 201);
}
