import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { digest, equalDigest } from '@daodejing/auth-kit';
import { ApiError, secrets } from './config';
import { cookie, cookies, input, json, cleanText, pageNumber } from './http';
import { authHandler, session, requireUser, requireOwner, profile } from './auth';
import { cloudVerification, type VerificationProvider } from './providers/verification';
import { audit, idempotent, rateLimit } from './persistence';
import { createShare, listShares, getShare, updateShare, recordRead, recordExposure, setLike, comments } from './content';
import { listPlaces, getPlace, searchPoi, nearbyPoi, proxyAmap, saveDojo, placeDto } from './places';
import { createGathering, getGathering, listGatherings, updateGathering } from './gatherings';
import { beginUpload, localUpload, completeUpload, serveMedia } from './media';

export function createApi(options: { db: PrismaClient; verification?: VerificationProvider; clock?: () => Date }) {
  const db = options.db; const providers = options.verification || cloudVerification;
  return async function handle(request: Request): Promise<Response> {
    const requestId = randomUUID();
    let visitorCookie: string | null = null;
    try {
      const url = new URL(request.url), path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
      const method = request.method; const now = options.clock?.() || new Date();
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new ApiError(405, '请求方式不受支持');
      if (!['GET', 'HEAD'].includes(method)) {
        const origin = request.headers.get('origin');
        if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== url.origin && origin !== process.env.APP_ORIGIN)) throw new ApiError(403, '请求来源不受信任', 'INVALID_ORIGIN');
        if (method !== 'DELETE' && !path.endsWith('/upload') && !(request.headers.get('content-type') || '').startsWith('application/json')) throw new ApiError(415, '请求格式不受支持');
      }
      if (path === '/health') return json({ ok: true });
      const secret = secrets();
      let rawVisitor = cookies(request).ddj_visitor || '';
      const [value, signature] = rawVisitor.split('.');
      if (!value || !signature || !equalDigest(signature, digest(secret.hmac, value))) { const id = randomUUID(); rawVisitor = `${id}.${digest(secret.hmac, id)}`; visitorCookie = cookie('ddj_visitor', rawVisitor, 365 * 86400); }
      const visitor = digest(secret.hmac, rawVisitor);
      const ip = digest(secret.hmac, request.headers.get('x-ddj-client-ip') || 'local');
      const user = await session(request, db);
      let response: Response;
      const shareMatch = /^\/shares\/([^/]+)(?:\/(view|exposure|like|comments))?$/.exec(path);
      const placeMatch = /^\/places\/([^/]+)$/.exec(path);
      const gatheringMatch = /^\/gatherings\/([^/]+)$/.exec(path);
      const mediaMatch = /^\/media\/([^/]+)(?:\/(upload|complete))?$/.exec(path);
      const commentMatch = /^\/comments\/([^/]+)$/.exec(path);

      if (path.startsWith('/auth/')) response = await authHandler(path.slice(6), request, db, providers, user, ip, now);
      else if (path === '/config' && method === 'GET') response = json({ amapKey: process.env.AMAP_WEB_KEY || null, mapSearch: !!process.env.AMAP_REST_KEY, sms: !!process.env.ALIBABA_PNVS_TEMPLATE_CODE && !!process.env.ALIBABA_CLOUD_ACCESS_KEY_ID, email: !!process.env.TENCENT_SES_TEMPLATE_ID && !!process.env.TENCENTCLOUD_SECRET_ID });
      else if (path === '/shares' && method === 'GET') response = json(await listShares(db, user, url.searchParams));
      else if (path === '/shares' && method === 'POST') response = await createShare(request, db, user, now);
      else if (shareMatch) {
        const [, id, action] = shareMatch;
        if (!action && method === 'GET') response = json(await getShare(db, id, user, visitor, now));
        else if (!action && method === 'PATCH') response = await updateShare(request, db, id, user);
        else if (action === 'view' && method === 'POST') response = await recordRead(request, db, id, user, visitor, now);
        else if (action === 'exposure' && method === 'POST') { await rateLimit(db, 'exposure', visitor, 300, 3600, now); response = await recordExposure(db, id, visitor, now); }
        else if (action === 'like' && method === 'PUT') response = await setLike(request, db, id, user, now);
        else if (action === 'comments' && ['GET', 'POST'].includes(method)) response = await comments(request, db, id, user, now);
        else throw new ApiError(405, '请求方式不受支持');
      }
      else if (commentMatch && method === 'DELETE') {
        const current = requireUser(user); const id = commentMatch[1];
        await db.$transaction(async tx => { const row = await tx.contentComment.findUnique({ where: { id } }); if (!row) throw new ApiError(404, '评论不存在'); requireOwner(current, row.authorId); await tx.contentComment.update({ where: { id }, data: { status: 'DELETED' } }); await audit(tx, current.id, 'COMMENT_DELETED', id); });
        response = json({ ok: true });
      }
      else if (path === '/places' && method === 'GET') response = json(await listPlaces(db, user, url.searchParams));
      else if (path === '/places' && method === 'POST') response = await saveDojo(request, db, user, now);
      else if (placeMatch && method === 'GET') response = json(await getPlace(db, placeMatch[1], user, url.searchParams.get('type')));
      else if (placeMatch && method === 'PATCH') response = await saveDojo(request, db, user, now, placeMatch[1]);
      else if (placeMatch && method === 'DELETE') {
        const current = requireUser(user); const id = placeMatch[1];
        await db.$transaction(async tx => { const dojo = await tx.dojo.findUnique({ where: { id } }); if (!dojo) throw new ApiError(404, '道场不存在'); requireOwner(current, dojo.ownerId); await tx.dojo.update({ where: { id }, data: { status: 'DELETED' } }); await audit(tx, current.id, 'DOJO_DELETED', id); }); response = json({ ok: true });
      }
      else if (path === '/poi/search' && method === 'GET') {
        const current = requireUser(user); const query = cleanText(100).min(2, '至少输入两个字').parse(url.searchParams.get('q'));
        await rateLimit(db, 'poi-search', current.id, 40, 3600, now); response = json(await searchPoi(query, current, now));
      }
      else if (path === '/poi/nearby' && method === 'POST') {
        const current = requireUser(user); const data = await input(request, z.object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) }).strict());
        await rateLimit(db, 'poi-search', current.id, 40, 3600, now); response = json(await nearbyPoi(data.longitude, data.latitude, current, now));
      }
      else if (path.startsWith('/amap/_AMapService/') && method === 'GET') { await rateLimit(db, 'map-proxy', ip, 300, 60, now); response = await proxyAmap(request); }
      else if (path === '/gatherings' && method === 'POST') response = await createGathering(request, db, user, now);
      else if (gatheringMatch && method === 'GET') response = json(await getGathering(db, gatheringMatch[1], user));
      else if (gatheringMatch && method === 'PATCH') response = await updateGathering(request, db, gatheringMatch[1], user, now);
      else if (path === '/feedback' && method === 'POST') {
        const data = await input(request, z.object({ body: cleanText(4000) }).strict());
        await rateLimit(db, 'feedback-ip', ip, 30, 86400, now); await rateLimit(db, 'feedback-visitor', visitor, 10, 86400, now);
        response = json(await idempotent(db, request, user?.id || visitor, data, async tx => { const row = await tx.feedback.create({ data: { body: data.body, accountId: user?.id, createdAt: now } }); return { id: row.id, status: 'SUBMITTED' }; }), 201);
      }
      else if (path === '/profile' && method === 'PATCH') {
        const current = requireUser(user); const data = await input(request, z.object({ name: cleanText(80), avatar: z.number().int().min(0).max(9) }).strict());
        await db.profile.update({ where: { accountId: current.id }, data: { displayName: data.name, avatar: data.avatar } }); response = json({ ok: true });
      }
      else if (path === '/profiles/search' && method === 'GET') {
        requireUser(user); const query = cleanText(80).min(2).parse(url.searchParams.get('q'));
        const rows = await db.profile.findMany({ where: { displayName: { contains: query }, account: { active: true } }, select: { accountId: true, displayName: true, avatar: true }, take: 8 }); response = json({ profiles: rows.map(row => ({ id: row.accountId, name: row.displayName, avatar: row.avatar })) });
      }
      else if (path === '/me/shares' && method === 'GET') response = json(await listShares(db, user, url.searchParams, true));
      else if (path === '/me/gatherings' && method === 'GET') response = json(await listGatherings(db, user, url.searchParams));
      else if (path === '/me/places' && method === 'GET') { const current = requireUser(user); const rows = await db.dojo.findMany({ where: { ownerId: current.id, status: { not: 'DELETED' } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: pageNumber(url.searchParams) * 20, take: 21 }); response = json({ places: rows.slice(0, 20).map(row => placeDto(row, current)), hasMore: rows.length > 20 }); }
      else if (path === '/media/sign-upload' && method === 'POST') response = await beginUpload(request, db, user, now);
      else if (mediaMatch) {
        const [, id, action] = mediaMatch;
        if (action === 'upload' && method === 'PUT') response = await localUpload(request, db, id, user);
        else if (action === 'complete' && method === 'POST') response = await completeUpload(db, id, user);
        else if (!action && ['GET', 'HEAD'].includes(method)) response = await serveMedia(request, db, id, user);
        else throw new ApiError(405, '请求方式不受支持');
      }
      else throw new ApiError(404, '没有找到这个页面或操作');

      if (visitorCookie) response.headers.append('Set-Cookie', visitorCookie);
      response.headers.set('X-Request-ID', requestId); return response;
    } catch (error) {
      const known = error as any;
      let status = error instanceof ApiError ? error.status : error instanceof ZodError ? 400 : known.code === 'P2002' ? 409 : known.code === 'P2025' ? 404 : /^P10/.test(known.code || '') ? 503 : 500;
      const message = error instanceof ApiError ? error.message : error instanceof ZodError ? error.issues[0]?.message || '请检查填写内容' : status === 409 ? '这条记录已存在，请勿重复提交' : status === 503 ? '服务暂时无法连接，请稍后再试' : status === 404 ? '记录不存在' : '服务暂时不可用，请稍后重试';
      if (status >= 500) console.error(JSON.stringify({ requestId, code: known.code || known.name || 'INTERNAL_ERROR' }));
      const response = new Response(JSON.stringify({ error: { message, code: known.code || 'REQUEST_FAILED', requestId, ...(error instanceof ApiError && error.retryAt ? { retryAt: error.retryAt } : {}) } }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
      if (visitorCookie) response.headers.append('Set-Cookie', visitorCookie);
      return response;
    }
  };
}
