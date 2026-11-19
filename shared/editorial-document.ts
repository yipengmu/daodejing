import { z } from 'zod';

const illustrationSchema = z.object({
  mediaId: z.string().min(1).max(100),
  alt: z.string().trim().min(1).max(240),
  caption: z.string().trim().min(1).max(300),
}).strict();

export const editorialDocument = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(1800),
  sections: z.array(z.object({
    title: z.string().min(1).max(120),
    paragraphs: z.array(z.string().min(1).max(4000)).min(1).max(30),
    illustration: illustrationSchema.optional(),
  }).strict()).min(1).max(30),
}).strict();

export type EditorialDocument = z.infer<typeof editorialDocument>;

export function illustrationIds(document?: EditorialDocument | null) {
  return [...new Set(document?.sections.flatMap(section => section.illustration ? [section.illustration.mediaId] : []) ?? [])];
}
