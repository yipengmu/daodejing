import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import type { PrismaClient } from '@prisma/client';
import { CHAPTER_57_PRESENTATION } from '../lib/lead-presentation';
import { audit } from '../lib/persistence';
import chapter57Document from '../prisma/seed/channel-materials/chapter-57-truth.json';

export async function seed(db: PrismaClient) {
  const source = YAML.parse(await readFile(new URL('../prisma/seed/daodejing.yaml', import.meta.url), 'utf8'));
  await db.edition.upsert({ where: { id: source.edition.id }, create: { id: source.edition.id, title: source.edition.title, label: source.edition.text_label, source: source.edition }, update: { source: source.edition } });
  for (const chapter of source.chapters) {
    await db.chapter.upsert({ where: { number: chapter.number }, create: { number: chapter.number, title: chapter.title, section: chapter.section }, update: { title: chapter.title, section: chapter.section } });
    await db.chapterText.upsert({ where: { chapterNumber_editionId: { chapterNumber: chapter.number, editionId: source.edition.id } }, create: { chapterNumber: chapter.number, editionId: source.edition.id, text: chapter.original_text, explanation: chapter.plain_explanation, source: { reviewStatus: 'editorial_draft', label: '用户提供文本' } }, update: {} });
    await db.chapterChannel.upsert({ where: { chapterNumber: chapter.number }, create: { id: `chapter-${chapter.number}`, chapterNumber: chapter.number }, update: {} });
  }
  const { id, chapter } = CHAPTER_57_PRESENTATION;
  const authorId = 'platform-editorial';
  await db.$transaction(async tx => {
    await tx.account.createMany({ skipDuplicates: true, data: [{ id: authorId, active: false, passwordHash: '!' }] });
    const created = await tx.contentItem.createMany({ skipDuplicates: true, data: [{
      id, chapterNumber: chapter, title: chapter57Document.title, body: chapter57Document.summary,
      authorId, publicName: '平台领读', contentType: 'LEAD_READING', importData: chapter57Document,
    }] });
    if (created.count) await audit(tx, authorId, 'SHARE_PUBLISHED', id, { source: 'chapter-57-truth' });
  });
  const locations = YAML.parse(await readFile(new URL('../prisma/seed/hangzhou-dojos.yaml', import.meta.url), 'utf8'));
  for (const place of locations.dataset.records) {
    const poi = place.poi || {}; const knownCrs = poi.coordinate_crs === 'GCJ-02';
    const fields = { name: place.name, district: place.district || '', address: place.address.normalized, description: place.activity_title || '', schedule: place.schedule, poiId: poi.provider_poi_id || null, poiName: poi.name, longitude: knownCrs ? poi.coordinate?.[0] : null, latitude: knownCrs ? poi.coordinate?.[1] : null, poiConfirmed: !!poi.provider_poi_id || (knownCrs && !!poi.coordinate), navigationQuery: poi.navigation_query, sourcePrivate: JSON.parse(JSON.stringify(place)), publicContact: null };
    await db.dojo.upsert({ where: { id: place.id }, create: { id: place.id, ...fields }, update: {} });
  }
  console.log(`已导入 ${source.chapters.length} 章及 ${locations.dataset.records.length} 个已提供地点，私人联系方式及住宅房号不进入公开字段。`);
}
if (process.argv[1]?.endsWith('/seed.ts')) {
  const { setupRuntime } = await import('./runtime'); await setupRuntime();
  const { prisma, closeDatabase } = await import('../lib/db'); try { await seed(prisma); } finally { await closeDatabase(); }
}
