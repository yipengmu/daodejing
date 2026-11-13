import { mkdir, access, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';

export async function setupRuntime(options: { localDevelopment?: boolean } = {}) {
  dotenv.config({ quiet: true });
  for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'JWT_SECRET', 'IDENTITY_HMAC_SECRET']) if (process.env[name] === '') delete process.env[name];
  const configuredDatabase = process.env.DATABASE_URL;
  const externalRequested = !options.localDevelopment || process.env.DEV_USE_EXTERNAL_DATABASE === 'true';
  if (options.localDevelopment && process.env.DEV_USE_EXTERNAL_DATABASE === 'true' && !configuredDatabase) {
    throw new Error('已请求使用外部数据库，但 .env 未配置 DATABASE_URL。');
  }
  const external = externalRequested && !!configuredDatabase && !configuredDatabase.includes('127.0.0.1:55432');
  if (external) {
    for (const name of ['JWT_SECRET', 'IDENTITY_HMAC_SECRET']) if (!process.env[name]) throw new Error(`外部数据库必须显式配置本项目的 ${name}，不使用本地开发密钥。`);
    process.env.LOCAL_DATABASE = 'false';
    return;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境必须显式配置独立 PostgreSQL 和密钥。');
  await mkdir('.local', { recursive: true });
  try { await access('.local/runtime.env'); } catch {
    const password = crypto.randomBytes(24).toString('hex');
    await writeFile('.local/runtime.env', `DATABASE_URL=postgresql://ddj:${password}@127.0.0.1:55432/daodejing\nDATABASE_URL_UNPOOLED=postgresql://ddj:${password}@127.0.0.1:55432/daodejing\nJWT_SECRET=${crypto.randomBytes(48).toString('hex')}\nIDENTITY_HMAC_SECRET=${crypto.randomBytes(48).toString('hex')}\n`, { mode: 0o600 });
  }
  dotenv.config({ path: '.local/runtime.env', override: true, quiet: true });
  process.env.LOCAL_DATABASE = 'true';
}
export function command(executable: string, args: string[], env = process.env) {
  return new Promise<void>((resolve, reject) => { const child = spawn(executable, args, { stdio: 'inherit', env }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${executable} failed (${code})`))); });
}
