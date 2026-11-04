import { spawn } from 'node:child_process';
import { setupRuntime, command } from './runtime';

await setupRuntime();
if (process.env.LOCAL_DATABASE !== 'true') console.log('使用配置的外部数据库；请先手动执行 db:migrate 和 db:seed。');
await command('npm', ['run', 'data:build']);
const { shutdown } = await import('../server/app');
const children = [spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' })];
let stopped = false;
async function stop() { if (stopped) return; stopped = true; for (const child of children) child.kill('SIGTERM'); await shutdown(); process.exit(0); }
for (const child of children) child.on('exit', () => { void stop(); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
