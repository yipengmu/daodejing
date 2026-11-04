import express from 'express';
import { createApi } from '../lib/api';
import { prisma, closeDatabase } from '../lib/db';
import { adaptNode } from '../lib/transport';

if (process.env.LOCAL_DATABASE === 'true') { const { seed } = await import('../scripts/seed'); await seed(prisma); }

const app = express();
app.disable('x-powered-by');
app.use('/api', express.raw({ type: () => true, limit: '21mb' }));
const handle = createApi({ db: prisma });
app.use(async (req, res) => { try { await adaptNode(req, res, handle); } catch { if (!res.headersSent) res.status(500).json({ error: { message: '服务暂时不可用' } }); else res.end(); } });
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ error: { message: error.status === 413 ? '上传文件过大' : '请求未能完成' } }));
export const server = app.listen(Number(process.env.API_PORT || 4318), '127.0.0.1', () => console.log(`API http://127.0.0.1:${process.env.API_PORT || 4318}`));
export async function shutdown() { await new Promise<void>(resolve => server.close(() => resolve())); await closeDatabase(); }
if (process.argv[1]?.endsWith('/server/app.ts')) {
  const close = async () => { await shutdown(); process.exit(0); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
}
