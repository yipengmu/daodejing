import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function normalizeIdentity(value: string) {
  const input = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) && input.length <= 254) return { kind: 'EMAIL', value: input.toLowerCase() };
  const phone = input.replace(/^\+?86/, '').replace(/[\s-]/g, '');
  if (/^1[3-9]\d{9}$/.test(phone)) return { kind: 'PHONE', value: phone };
  if (/^[A-Za-z0-9_]{3,32}$/.test(input)) return { kind: 'USERNAME', value: input.toLowerCase() };
  throw new Error('请输入有效的邮箱或中国大陆手机号');
}
export function digest(secret: string, value: string) { return createHmac('sha256', secret).update(value).digest('hex'); }
export function equalDigest(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const hashPassword = (value: string) => bcrypt.hash(value, 12);
export const verifyPassword = (value: string, hash: string) => bcrypt.compare(value, hash);
export function signSession(account: { id: string; authVersion: number }, secret: string) {
  return jwt.sign({ version: account.authVersion }, secret, { subject: account.id, expiresIn: '30d', issuer: 'daodejing', audience: 'daodejing-web' });
}
export function verifySession(token: string, secret: string) {
  const payload = jwt.verify(token, secret, { issuer: 'daodejing', audience: 'daodejing-web', algorithms: ['HS256'] });
  if (typeof payload === 'string' || !payload.sub || typeof payload.version !== 'number') throw new Error('会话无效');
  return { id: payload.sub, version: payload.version as number };
}
