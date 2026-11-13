import type { Account, PrismaClient } from '@prisma/client';
import { digest, equalDigest, hashPassword, normalizeIdentity, signSession, verifyPassword, verifySession } from '@daodejing/auth-kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError, secrets } from './config';
import { cookie, cookies, input, json, passwordSchema, cleanText } from './http';
import { rateLimit, audit, type Db } from './persistence';
import { generateEmailCode, type VerificationProvider } from './providers/verification';

export type User = Account & { profile: { displayName: string; avatar: number } | null };
export function identity(value: string) {
  try { const result = normalizeIdentity(value); return { ...result, lookupHash: digest(secrets().hmac, `${result.kind}:${result.value}`) }; }
  catch { throw new ApiError(400, '账号需为 3–32 位字母、数字或下划线'); }
}
export async function session(request: Request, db: PrismaClient): Promise<User | null> {
  const token = cookies(request).ddj_session;
  if (!token) return null;
  try {
    const claims = verifySession(token, secrets().jwt);
    const user = await db.account.findUnique({ where: { id: claims.id }, include: { profile: true } });
    return user?.active && user.authVersion === claims.version ? user : null;
  } catch (error) { if (error instanceof ApiError) throw error; return null; }
}
export function requireUser(user: User | null): User {
  if (!user) throw new ApiError(401, '请先登录，再继续刚才的操作', 'LOGIN_REQUIRED');
  return user;
}
export function requireOwner(user: User | null, ownerId: string | null) {
  const current = requireUser(user);
  if (current.id !== ownerId && current.role !== 'ADMIN') throw new ApiError(403, '只能管理自己创建的内容', 'FORBIDDEN');
  return current;
}
export function profile(user: User) { return { id: user.id, name: user.profile?.displayName || '共读者', avatar: user.profile?.avatar || 0, isAdmin: user.role === 'ADMIN' }; }
async function consume(tx: Db, challengeId: string, now: Date) {
  const result = await tx.verification.updateMany({ where: { id: challengeId, consumedAt: null, expiresAt: { gt: now }, failures: { lte: 5 } }, data: { consumedAt: now } });
  if (result.count !== 1) throw new ApiError(400, '验证码已使用或过期，请重新获取');
}
async function checkCode(db: PrismaClient, providers: VerificationProvider, data: { identifier: string; challengeId: string; code: string }, purpose: string, now: Date, accountId?: string) {
  const id = identity(data.identifier);
  const challenge = await db.verification.findUnique({ where: { id: data.challengeId } });
  if (!challenge || challenge.lookupHash !== id.lookupHash || challenge.kind !== id.kind || challenge.purpose !== purpose || challenge.consumedAt || challenge.expiresAt <= now || (purpose === 'RECOVERY' && challenge.accountId !== accountId)) throw new ApiError(400, '验证码错误或已过期');
  const attempt = await db.verification.updateMany({ where: { id: challenge.id, consumedAt: null, failures: { lt: 5 }, expiresAt: { gt: now } }, data: { failures: { increment: 1 } } });
  if (!attempt.count) throw new ApiError(400, '验证码尝试次数已用完，请重新获取');
  const valid = id.kind === 'PHONE' ? await providers.checkPhone(id.value, data.code, challenge.providerRef!) : equalDigest(challenge.codeHash || '', digest(secrets().hmac, `${challenge.id}:${data.code}`));
  if (!valid) throw new ApiError(400, '验证码错误或已过期');
  return { ...id, challengeId: challenge.id };
}
const verificationSchema = z.object({ identifier: cleanText(254), challengeId: cleanText(100), code: z.string().regex(/^\d{6}$/, '请输入六位验证码') });
const signedInResponse = (user: User) => { const response = json({ user: profile(user) }); response.headers.append('Set-Cookie', cookie('ddj_session', signSession(user, secrets().jwt), 30 * 86400)); return response; };

export async function authHandler(action: string, request: Request, db: PrismaClient, providers: VerificationProvider, user: User | null, ip: string, now: Date): Promise<Response> {
  if (action === 'me' && request.method === 'GET') {
    if (!user) return json({ user: null });
    const recovery = await db.authIdentity.findFirst({ where: { accountId: user.id, kind: 'EMAIL', recovery: true } });
    return json({ user: { ...profile(user), recoveryEmail: recovery?.value || null } });
  }
  if (request.method !== 'POST') throw new ApiError(405, '此操作不支持当前请求方式');
  if (action === 'logout') { const response = json({ ok: true }); response.headers.append('Set-Cookie', cookie('ddj_session', '', 0)); return response; }
  if (action === 'send-code' || action === 'phone-send-code') {
    const data = await input(request, z.object({ identifier: cleanText(254), purpose: z.enum(['REGISTER', 'RESET', 'RECOVERY']) }));
    const id = identity(data.identifier);
    if (data.purpose === 'RECOVERY') { requireUser(user); if (id.kind !== 'EMAIL') throw new ApiError(400, '恢复方式需为邮箱'); }
    await rateLimit(db, 'code-ip-hour', ip, 10, 3600, now);
    await rateLimit(db, 'code-identity-minute', id.lookupHash, 1, 60, now);
    await rateLimit(db, 'code-identity-day', id.lookupHash, 5, 86400, now);
    const challengeId = randomUUID(); const providerRef = randomUUID(); const code = generateEmailCode();
    try {
      if (id.kind === 'EMAIL') await providers.sendEmail(id.value, code, data.purpose);
      else await providers.sendPhone(id.value, providerRef);
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, '验证码发送失败，请稍后重试', 'PROVIDER_UNAVAILABLE'); }
    await db.verification.create({ data: { id: challengeId, kind: id.kind, lookupHash: id.lookupHash, purpose: data.purpose, accountId: data.purpose === 'RECOVERY' ? user!.id : null, provider: id.kind === 'PHONE' ? 'ALIYUN_PNVS' : 'TENCENT_SES', codeHash: id.kind === 'EMAIL' ? digest(secrets().hmac, `${challengeId}:${code}`) : null, providerRef: id.kind === 'PHONE' ? providerRef : null, createdAt: now, expiresAt: new Date(now.getTime() + 300000) } });
    return json({ challengeId, expiresIn: 300, retryAt: new Date(now.getTime() + 60000).toISOString() });
  }
  if (action === 'login') {
    const data = await input(request, z.object({ identifier: cleanText(254), password: z.string().min(1).max(128) }));
    const id = identity(data.identifier);
    await rateLimit(db, 'login-ip', ip, 30, 900, now); await rateLimit(db, 'login-account', id.lookupHash, 10, 900, now);
    const found = await db.authIdentity.findUnique({ where: { kind_lookupHash: { kind: id.kind, lookupHash: id.lookupHash } }, include: { account: { include: { profile: true } } } });
    const account = found?.account;
    const matches = await verifyPassword(data.password, account?.passwordHash || '$2b$12$QnCVLYfeVEH4zDRvWNQ4Qe18vOdWe9qTIfZt9utWMrt.lNsJmtawS');
    if (!account?.active || !matches) throw new ApiError(401, '账号或密码不正确', 'LOGIN_FAILED');
    return signedInResponse(account);
  }
  if (action === 'register') {
    const data = await input(request, z.object({ identifier: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/, '账号仅支持字母、数字和下划线'), password: passwordSchema, name: cleanText(80) }));
    await rateLimit(db, 'register-ip', ip, 10, 3600, now);
    const checked = identity(data.identifier);
    const passwordHash = await hashPassword(data.password);
    const account = await db.$transaction(async tx => {
      return tx.account.create({ data: { passwordHash, profile: { create: { displayName: data.name, avatar: Math.floor(Math.random() * 10) } }, identities: { create: { kind: checked.kind, lookupHash: checked.lookupHash, value: checked.value } } }, include: { profile: true } });
    });
    return signedInResponse(account);
  }
  if (action === 'reset-password') {
    const data = await input(request, verificationSchema.extend({ password: passwordSchema }));
    await rateLimit(db, 'reset-ip', ip, 15, 3600, now);
    const checked = await checkCode(db, providers, data, 'RESET', now);
    const found = await db.authIdentity.findUnique({ where: { kind_lookupHash: { kind: checked.kind, lookupHash: checked.lookupHash } } });
    if (!found) throw new ApiError(400, '验证码或账号信息不正确');
    const passwordHash = await hashPassword(data.password);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${found.accountId} FOR UPDATE`;
      const account = await tx.account.findUniqueOrThrow({ where: { id: found.accountId } });
      const retry = account.lastPhoneResetAt ? new Date(account.lastPhoneResetAt.getTime() + 86400000) : null;
      if (checked.kind === 'PHONE' && retry && retry > now) throw new ApiError(429, '该账号在 24 小时内已重置过密码，请稍后再试', 'RESET_LIMITED', retry.toISOString());
      await consume(tx, checked.challengeId, now);
      await tx.account.update({ where: { id: account.id }, data: { passwordHash, authVersion: { increment: 1 }, ...(checked.kind === 'PHONE' ? { lastPhoneResetAt: now } : {}) } });
      await audit(tx, account.id, 'PASSWORD_RESET', account.id);
    });
    const response = json({ ok: true }); response.headers.append('Set-Cookie', cookie('ddj_session', '', 0)); return response;
  }
  if (action === 'bind-recovery') {
    const current = requireUser(user);
    const data = await input(request, verificationSchema);
    const checked = await checkCode(db, providers, data, 'RECOVERY', now, current.id);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${current.id} FOR UPDATE`;
      const recovery = await tx.authIdentity.findFirst({ where: { accountId: current.id, recovery: true } });
      if (recovery && recovery.lookupHash !== checked.lookupHash) throw new ApiError(409, '恢复邮箱已绑定，本期暂不支持更换');
      const existing = await tx.authIdentity.findUnique({ where: { kind_lookupHash: { kind: checked.kind, lookupHash: checked.lookupHash } } });
      if (existing && existing.accountId !== current.id) throw new ApiError(409, '该邮箱已绑定其他账号');
      await consume(tx, checked.challengeId, now);
      await tx.authIdentity.upsert({ where: { kind_lookupHash: { kind: checked.kind, lookupHash: checked.lookupHash } }, create: { accountId: current.id, kind: checked.kind, lookupHash: checked.lookupHash, value: checked.value, recovery: true }, update: { recovery: true } });
      await audit(tx, current.id, 'BIND_RECOVERY_EMAIL', current.id);
    });
    return json({ ok: true });
  }
  throw new ApiError(404, '没有这个账号操作');
}
