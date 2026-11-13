import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { digest, equalDigest } from '@daodejing/auth-kit';
import { ApiError, required } from './config';
import { chapterNumber, input, json } from './http';
import type { User } from './auth';
import { rateLimit, shanghaiDay } from './persistence';

function signed(payload: string) {
  return `${payload}.${digest(required('IDENTITY_HMAC_SECRET'), payload)}`;
}

function readTicket(chapter: number, visitor: string, now: Date) {
  return signed(Buffer.from(JSON.stringify({ chapter, visitor, at: now.getTime() })).toString('base64url'));
}

function verifyTicket(ticket: string, chapter: number, visitor: string, now: Date) {
  try {
    const [payload, signature] = ticket.split('.');
    if (!payload || !signature || !equalDigest(signature, digest(required('IDENTITY_HMAC_SECRET'), payload))) throw new Error();
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const elapsed = now.getTime() - parsed.at;
    if (parsed.chapter !== chapter || parsed.visitor !== visitor || elapsed < 5000 || elapsed > 1800000) throw new Error();
  } catch { throw new ApiError(400, '阅读记录无效，请重新打开本章', 'INVALID_CHAPTER_READ'); }
}

export async function issueChapterReadTicket(db: PrismaClient, chapter: number, visitor: string, now: Date) {
  if (!(await db.chapter.findUnique({ where: { number: chapter }, select: { number: true } }))) throw new ApiError(404, '章节不存在');
  return json({ ticket: readTicket(chapter, visitor, now) });
}

export async function recordChapterRead(request: Request, db: PrismaClient, chapter: number, user: User | null, visitor: string, now: Date) {
  const { ticket } = await input(request, z.object({ ticket: z.string().min(1).max(2000) }).strict());
  verifyTicket(ticket, chapter, visitor, now);
  await rateLimit(db, 'chapter-read', visitor, 300, 3600, now);
  const readerKey = digest(required('IDENTITY_HMAC_SECRET'), user ? `account:${user.id}` : `guest:${visitor}`);
  await db.chapterRead.createMany({ data: [{ chapterNumber: chapter, readerKey, visitorHash: visitor, readDay: shanghaiDay(now), createdAt: now }], skipDuplicates: true });
  return json({ ok: true });
}

export async function chapterHeat(db: PrismaClient) {
  const rows = await db.$queryRaw<Array<{ number: number; reads: bigint; likes: bigint; comments: bigint }>>`
    SELECT c."number" AS number,
      COALESCE(v.total, 0)::bigint AS reads,
      COALESCE(l.total, 0)::bigint AS likes,
      COALESCE(cm.total, 0)::bigint AS comments
    FROM "Chapter" c
    LEFT JOIN (SELECT "chapterNumber", COUNT(*) AS total FROM "ChapterRead" GROUP BY "chapterNumber") v ON v."chapterNumber" = c."number"
    LEFT JOIN (SELECT ci."chapterNumber", COUNT(*) AS total FROM "ContentLike" l JOIN "ContentItem" ci ON ci.id = l."contentId" WHERE ci.status = 'PUBLISHED' GROUP BY ci."chapterNumber") l ON l."chapterNumber" = c."number"
    LEFT JOIN (SELECT ci."chapterNumber", COUNT(*) AS total FROM "ContentComment" cm JOIN "ContentItem" ci ON ci.id = cm."contentId" WHERE ci.status = 'PUBLISHED' AND cm.status = 'PUBLISHED' GROUP BY ci."chapterNumber") cm ON cm."chapterNumber" = c."number"
    ORDER BY c."number"
  `;
  return json({ chapters: rows.map(row => {
    const score = Number(row.reads) + Number(row.likes) * 2 + Number(row.comments) * 3;
    return { chapter: row.number, intensity: score === 0 ? 0 : Math.min(0.82, 0.18 + 0.64 * (1 - Math.exp(-score / 24))) };
  }) });
}
