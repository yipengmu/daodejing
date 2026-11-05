import { readFile, mkdir, writeFile } from 'node:fs/promises';
import YAML from 'yaml';

const raw = YAML.parse(await readFile(new URL('../prisma/seed/daodejing.yaml', import.meta.url), 'utf8'));
const content = {
  edition: { id: raw.edition.id, title: raw.edition.title, label: raw.edition.text_label, sourceNote: raw.edition.source_note, annotationPolicy: raw.edition.annotation_policy },
  chapters: raw.chapters.map((c: Record<string, any>) => ({ number: c.number, section: c.section, title: c.title, text: c.original_text, explanation: c.plain_explanation, explanationLabel: '平台编辑整理 · 未审定', commentary: null })),
};
if (content.chapters.length !== 81 || new Set(content.chapters.map((c: any) => c.number)).size !== 81) throw new Error('章节必须完整包含 81 章');
await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/data/content.json', import.meta.url), JSON.stringify(content));
console.log('已从现有种子生成 81 章阅读数据，保留用户提供文本来源。');
