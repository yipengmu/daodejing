import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ANNOTATION_BATCH_SIZE, ANNOTATION_BODY_LIMIT, matchesAnnotation } from '../shared/reading-annotations';
import { requireUser, type User } from './auth';
import { ApiError } from './config';
import { chapterNumber, input, json, pageNumber } from './http';
import { rateLimit } from './persistence';

const noteId = z.string().uuid();
const editionId = z.string().min(1).max(100);
const noteBody = z.string().trim().max(ANNOTATION_BODY_LIMIT).refine(value => !value.includes('\0'), '批注含无效字符');
const draft = z.object({
  id: noteId,
  chapterNumber: z.number().int().min(1).max(81),
  editionId,
  start: z.number().int().min(0).max(10000),
  end: z.number().int().min(1).max(10000),
  quote: z.string().min(1).max(20000),
  body: noteBody,
}).strict().refine(note => note.end - note.start === Array.from(note.quote).length && !note.quote.includes('\0'), '原文摘录位置无效');
const noteFields = { id: true, chapterNumber: true, editionId: true, start: true, end: true, quote: true, body: true } as const;
const ownFields = { ...noteFields, version: true, published: true } as const;

function accountForRequest(request: Request, user: User | null) {
  const account = requireUser(user);
  if (request.headers.get('x-ddj-annotation-account') !== account.id) {
    throw new ApiError(409, '当前登录账号已变化，请重新打开阅读页', 'ANNOTATION_ACCOUNT_CHANGED');
  }
  return account;
}

export async function myAnnotations(request: Request, db: PrismaClient, user: User | null, now: Date) {
  const account = accountForRequest(request, user);
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const annotations = await db.readingAnnotation.findMany({
      where: { accountId: account.id, chapterNumber: chapterNumber.parse(params.get('chapter')), editionId: editionId.parse(params.get('edition')), deleted: false },
      select: ownFields,
      orderBy: [{ start: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return json({ annotations });
  }
  const { annotations } = await input(request, z.object({ annotations: z.array(draft).min(1).max(ANNOTATION_BATCH_SIZE) }).strict());
  await rateLimit(db, 'annotation-import', account.id, 200, 3600, now);
  await db.readingAnnotation.createMany({
    data: annotations.map(note => ({ ...note, accountId: account.id })),
    skipDuplicates: true,
  });
  return json({ ok: true });
}

export async function changeAnnotation(request: Request, db: PrismaClient, user: User | null, id: string, now: Date) {
  const account = accountForRequest(request, user);
  const where = { accountId: account.id, id: noteId.parse(id), deleted: false };
  const data = await input(request, z.object({
    version: z.number().int().positive(),
    body: noteBody.optional(),
    published: z.boolean().optional(),
    deleted: z.literal(true).optional(),
  }).strict().refine(change => change.deleted ? change.body === undefined && change.published === undefined : change.body !== undefined || change.published !== undefined));
  await rateLimit(db, 'annotation-edit', account.id, 120, 3600, now);
  const current = await db.readingAnnotation.findFirst({ where, select: ownFields });
  if (!current) throw new ApiError(404, '标注已不存在');
  if (current.version !== data.version) throw new ApiError(409, '标注已在别处更新，请查看最新内容', 'ANNOTATION_CONFLICT');
  const body = data.deleted ? '' : data.body ?? current.body;
  const published = data.deleted ? false : data.published ?? current.published;
  if (published) {
    if (!body) throw new ApiError(400, '写下批注后才可以公开');
    const source = await db.chapterText.findUnique({
      where: { chapterNumber_editionId: { chapterNumber: current.chapterNumber, editionId: current.editionId } },
      select: { text: true },
    });
    if (!source || !matchesAnnotation(current, Array.from(source.text))) throw new ApiError(400, '这段摘录与当前底本不一致，无法公开');
  }
  const result = await db.readingAnnotation.updateMany({
    where: { ...where, version: data.version },
    data: { body, published, deleted: data.deleted, quote: data.deleted ? '' : undefined, version: { increment: 1 } },
  });
  if (!result.count) throw new ApiError(409, '标注已在别处更新，请查看最新内容', 'ANNOTATION_CONFLICT');
  return json({ annotation: data.deleted ? null : { ...current, body, published, version: current.version + 1 } });
}

export async function publicAnnotations(db: PrismaClient, chapter: string, params: URLSearchParams) {
  const chapterNumber_editionId = { chapterNumber: chapterNumber.parse(chapter), editionId: editionId.parse(params.get('edition')) };
  const page = pageNumber(params);
  const [source, rows] = await Promise.all([
    db.chapterText.findUnique({ where: { chapterNumber_editionId }, select: { text: true } }),
    db.readingAnnotation.findMany({
      where: { ...chapterNumber_editionId, published: true, deleted: false, account: { active: true } },
      select: { ...noteFields, updatedAt: true, account: { select: { profile: { select: { displayName: true } } } } },
      orderBy: [{ updatedAt: 'desc' }, { accountId: 'asc' }, { id: 'asc' }],
      skip: page * 20,
      take: 21,
    }),
  ]);
  const characters = Array.from(source?.text ?? '');
  const annotations = rows.slice(0, 20).filter(note => matchesAnnotation(note, characters)).map(({ account, ...note }) => ({
    ...note,
    name: account.profile?.displayName || '共读者',
  }));
  return json({ annotations, hasMore: rows.length > 20 });
}
