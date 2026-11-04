import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { digest } from '@daodejing/auth-kit';
import { ApiError, required } from './config';

export type Db = Prisma.TransactionClient;
export async function rateLimit(db: PrismaClient, category: string, subject: string, limit: number, seconds: number, now = new Date()) {
  const bucket = Math.floor(now.getTime() / (seconds * 1000));
  const key = digest(required('IDENTITY_HMAC_SECRET'), `${category}:${subject}:${bucket}`);
  const expiresAt = new Date((bucket + 1) * seconds * 1000);
  const row = await db.rateBucket.upsert({ where: { key }, create: { key, expiresAt }, update: { count: { increment: 1 } } });
  if (row.count > limit) throw new ApiError(429, '操作太频繁，请稍后再试', 'RATE_LIMITED', expiresAt.toISOString());
}
export async function audit(db: Db, actorId: string, action: string, objectId: string, detail?: Prisma.InputJsonValue) {
  await db.auditEvent.create({ data: { actorId, action, objectId, ...(detail ? { detail } : {}) } });
}
export async function idempotent<T>(db: PrismaClient, request: Request, actor: string, payload: unknown, work: (tx: Db) => Promise<T>) {
  const raw = request.headers.get('idempotency-key');
  if (!raw || !/^[\w-]{16,100}$/.test(raw)) throw new ApiError(400, '提交标识缺失，请重新提交', 'IDEMPOTENCY_REQUIRED');
  const key = digest(required('IDENTITY_HMAC_SECRET'), `${actor}:${request.method}:${new URL(request.url).pathname}:${raw}`);
  const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
    const previous = await tx.idempotencyRecord.findUnique({ where: { key } });
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ApiError(409, '相同提交标识不能用于不同内容', 'IDEMPOTENCY_CONFLICT');
      return previous.response as T;
    }
    const response = await work(tx);
    await tx.idempotencyRecord.create({ data: { key, requestHash, response: JSON.parse(JSON.stringify(response)) } });
    return response;
  }, { timeout: 15000 });
}
export const shanghaiDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
