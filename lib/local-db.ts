import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';
import { mkdir, readdir, readFile, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

async function hasKnownContentTypeSchema(engine: PGlite) {
  const column = await engine.query<{ column_default: string | null }>("SELECT column_default FROM information_schema.columns WHERE table_name = 'ContentItem' AND column_name = 'contentType'");
  const constraints = await engine.query<{ conname: string; definition: string }>("SELECT con.conname, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid WHERE c.relname = 'ContentItem' AND con.conname IN ('ContentItem_contentType_check', 'ContentItem_author_or_import_check')");
  const byName = new Map(constraints.rows.map(row => [row.conname, row.definition]));
  const typeCheck = byName.get('ContentItem_contentType_check') || '';
  const authorCheck = byName.get('ContentItem_author_or_import_check') || '';
  const defaultValue = column.rows[0]?.column_default;
  const legacy = defaultValue === "'COMMUNITY'::text" && typeCheck.includes("'COMMUNITY'") && typeCheck.includes("'EDITORIAL_MATERIAL'") && typeCheck.includes("'AGENT_NOTES'") && authorCheck.includes('"importData" IS NULL');
  const current = defaultValue === "'FIELD_NOTE'::text" && typeCheck.includes("'FIELD_NOTE'") && typeCheck.includes("'LEAD_READING'") && typeCheck.includes("'AGENT_NOTES'") && authorCheck.includes('"importData" IS NOT NULL') && !authorCheck.includes('"importData" IS NULL');
  return legacy || current;
}

export async function createLocalDatabase(directory: string) {
  await mkdir(directory, { recursive: true });
  const lockPath = path.resolve(directory, 'owner.lock');
  try { const file = await open(lockPath, 'wx'); await file.writeFile(String(process.pid)); await file.close(); }
  catch {
    const pid = Number(await readFile(lockPath, 'utf8').catch(() => '0'));
    let stale = false; try { if (pid) process.kill(pid, 0); else stale = true; } catch (e: any) { if (e.code === 'ESRCH') stale = true; }
    if (!stale) throw new Error('本地数据库已由其他进程打开，请先停止该进程再运行数据库工具。');
    await unlink(lockPath); const file = await open(lockPath, 'wx'); await file.writeFile(String(process.pid)); await file.close();
  }
  const engine = new PGlite(path.resolve(directory, 'data'));
  try {
    await engine.waitReady;
    await engine.exec('CREATE TABLE IF NOT EXISTS _ddj_local_migrations (name text PRIMARY KEY, checksum text NOT NULL)');
    for (const name of (await readdir('prisma/migrations')).filter(x => /^\d/.test(x)).sort()) {
      const sql = await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'); const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await engine.query<{ checksum: string }>('SELECT checksum FROM _ddj_local_migrations WHERE name=$1', [name]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum) {
          const knownContentTypeDrift = name === '202611130001_channel_material_type' && await hasKnownContentTypeSchema(engine);
          if (!knownContentTypeDrift) throw new Error(`迁移 ${name} 已执行后被修改，需新增迁移。`);
        }
        continue;
      }
      await engine.transaction(async tx => { await tx.exec(sql); await tx.query('INSERT INTO _ddj_local_migrations (name,checksum) VALUES ($1,$2)', [name, checksum]); });
    }
    const client = new PrismaClient({ adapter: new PrismaPGlite(engine) });
    let closed = false;
    return { client, engine, async close() { if (closed) return; closed = true; await client.$disconnect(); await engine.close(); await unlink(lockPath).catch(() => {}); } };
  } catch (error) { await engine.close().catch(() => {}); await unlink(lockPath).catch(() => {}); throw error; }
}
