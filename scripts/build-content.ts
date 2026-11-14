import { readFile, mkdir, writeFile } from 'node:fs/promises';
import YAML from 'yaml';

const raw = YAML.parse(await readFile(new URL('../prisma/seed/daodejing.yaml', import.meta.url), 'utf8'));
const heshanggong = JSON.parse(await readFile(new URL('../prisma/seed/heshanggong-commentary.json', import.meta.url), 'utf8'));
const content = {
  edition: { id: raw.edition.id, title: raw.edition.title, label: raw.edition.text_label, sourceNote: raw.edition.source_note, annotationPolicy: raw.edition.annotation_policy },
  chapters: raw.chapters.map((c: Record<string, any>) => ({ number: c.number, section: c.section, title: c.title, text: c.original_text, explanation: c.plain_explanation, explanationLabel: '平台编辑整理 · 未审定', commentary: heshanggong.chapters[String(c.number)] ?? null, commentarySource: heshanggong.source })),
};
if (content.chapters.length !== 81 || new Set(content.chapters.map((c: any) => c.number)).size !== 81) throw new Error('章节必须完整包含 81 章');
if (content.chapters.some((c: any) => !c.commentary?.length)) throw new Error('河上公古注须完整覆盖 81 章');
await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/data/content.json', import.meta.url), JSON.stringify(content));
await writeFile(new URL('../src/data/chapter-index.json', import.meta.url), JSON.stringify(content.chapters.map((chapter: { number: number; text: string }) => ({ number: chapter.number, title: chapter.text.split(/[，；。！？]/)[0], excerpt: chapter.text.slice(0, 45) }))));
console.log('已生成 81 章阅读数据，包含用户提供经文和有来源的河上公古注。');
