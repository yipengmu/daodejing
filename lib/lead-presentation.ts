import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from './config';

export const CHAPTER_57_PRESENTATION = { id: 'chapter-57-truth-reading', chapter: 57 } as const;

const presentationFiles = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['slides.css', 'text/css; charset=utf-8'],
  ['slides.js', 'text/javascript; charset=utf-8'],
  ['moonlit-plum.jpg', 'image/jpeg'],
]);

export function presentationUrl(share: { id: string; chapterNumber: number; contentType: string; status: string }) {
  if (share.id !== CHAPTER_57_PRESENTATION.id || share.chapterNumber !== CHAPTER_57_PRESENTATION.chapter ||
      share.contentType !== 'LEAD_READING' || share.status !== 'PUBLISHED') return null;
  return `/api/shares/${share.id}/presentation/index.html`;
}

export async function serveLeadPresentation(request: Request, db: PrismaClient, id: string, file: string) {
  const mime = presentationFiles.get(file);
  if (id !== CHAPTER_57_PRESENTATION.id || !mime) throw new ApiError(404, '领读材料不存在或已停止公开');
  const share = await db.contentItem.findUnique({ where: { id }, select: { id: true, chapterNumber: true, contentType: true, status: true } });
  if (!share || !presentationUrl(share)) throw new ApiError(404, '领读材料不存在或已停止公开');

  const bytes = await readFile(join(process.cwd(), 'sites/chapter-57-reading/dist', file));
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: {
    'Content-Type': mime,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  } });
}
