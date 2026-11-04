import { setupRuntime } from './runtime';
import { digest, normalizeIdentity } from '@daodejing/auth-kit';
const [identifier, role, flag] = process.argv.slice(2);
if (!identifier || !['ADMIN', 'MEMBER'].includes(role) || (flag && flag !== '--external')) throw new Error('用法：npm run account:role -- <邮箱或手机号> ADMIN|MEMBER [--external]');
await setupRuntime();
if (process.env.LOCAL_DATABASE !== 'true' && flag !== '--external') throw new Error('外部数据库需显式追加 --external；请先核对 DATABASE_URL 目标环境。');
console.log(`角色变更目标：${new URL(process.env.DATABASE_URL!).hostname}；${process.env.LOCAL_DATABASE === 'true' ? '本地 PGlite' : '外部 PostgreSQL'}`);
const normalized = normalizeIdentity(identifier);
const { prisma, closeDatabase } = await import('../lib/db');
try {
  const identity = await prisma.authIdentity.findUnique({ where: { kind_lookupHash: { kind: normalized.kind, lookupHash: digest(process.env.IDENTITY_HMAC_SECRET!, `${normalized.kind}:${normalized.value}`) } } });
  if (!identity) throw new Error('目标账号不存在；不会自动创建或提升其他账号。');
  await prisma.$transaction(async tx => {
    const current = await tx.account.findUniqueOrThrow({ where: { id: identity.accountId } });
    await tx.account.update({ where: { id: current.id }, data: { role, authVersion: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId: 'operator-cli', action: 'ROLE_SET_BY_OPERATOR_CLI', objectId: current.id, detail: { from: current.role, to: role, source: 'operator-cli' } } });
  });
  console.log(`账号 ${identity.accountId} 已设为 ${role}，旧会话已撤销；请重新登录。`);
} finally { await closeDatabase(); }
