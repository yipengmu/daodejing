import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { command } from './runtime';
const directory = await mkdtemp(path.join(os.tmpdir(), 'ddj-tests-'));
const env = { ...process.env, NODE_ENV: 'test', TEST_DB_DIR: directory, LOCAL_MEDIA_DIR: path.join(directory, 'media'), DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/isolated_test', DATABASE_URL_UNPOOLED: 'postgresql://test:test@127.0.0.1:1/isolated_test', JWT_SECRET: crypto.randomBytes(40).toString('hex'), IDENTITY_HMAC_SECRET: crypto.randomBytes(40).toString('hex') };
for (const key of Object.keys(env)) if (/^(TENCENT|ALIBABA|AMAP|APP_ORIGIN)/.test(key)) delete (env as Record<string, string | undefined>)[key];
try { await command(process.execPath, ['--import', 'tsx', '--test', 'tests/api.test.ts', 'tests/audio-denoise.test.ts'], env); }
finally { await rm(directory, { recursive: true, force: true }); }
