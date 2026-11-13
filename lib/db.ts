import './config';
import { PrismaClient } from '@prisma/client';
// Vercel's Neon integration prefixes this project's connection URL.
// An explicitly configured DATABASE_URL always takes precedence.
process.env.DATABASE_URL ||= process.env.DAODEJING_DATABASE_URL;
const globalDb = globalThis as unknown as { ddjPrisma?: PrismaClient; ddjClose?: () => Promise<void> };
const local = process.env.LOCAL_DATABASE === 'true';
if (local && process.env.NODE_ENV === 'production') throw new Error('生产环境必须使用独立 PostgreSQL，不能启用本地数据库');
if (!globalDb.ddjPrisma) {
  if (local) {
    const { createLocalDatabase } = await import('./local-db');
    const database = await createLocalDatabase(process.env.LOCAL_DATABASE_DIR || '.local/pglite');
    globalDb.ddjPrisma = database.client; globalDb.ddjClose = database.close;
  } else { globalDb.ddjPrisma = new PrismaClient(); globalDb.ddjClose = () => globalDb.ddjPrisma!.$disconnect(); }
}
export const prisma = globalDb.ddjPrisma;
export const closeDatabase = () => globalDb.ddjClose!();
