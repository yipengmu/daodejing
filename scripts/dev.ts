import { spawn } from 'node:child_process';
import { setupRuntime, command } from './runtime';

await setupRuntime();
if (process.env.LOCAL_DATABASE !== 'true') console.log('使用配置的外部数据库；请先手动执行 db:migrate 和 db:seed。');
await command('npm', ['run', 'data:build']);
const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/app.ts'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit', env: process.env }),
];
let stopped = false;
async function stop(signal: NodeJS.Signals = 'SIGTERM', exitCode = 0) {
  if (stopped) return;
  stopped = true;
  for (const child of children) if (child.exitCode === null && !child.killed) child.kill(signal);
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise<void>(resolve => child.once('close', () => resolve()))));
  process.exit(exitCode);
}
for (const child of children) {
  child.on('error', error => { console.error('开发子进程启动失败：', error); void stop('SIGTERM', 1); });
  child.on('exit', code => { if (!stopped) void stop('SIGTERM', code ?? 1); });
}
process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });
