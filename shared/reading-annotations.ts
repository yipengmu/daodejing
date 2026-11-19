export const ANNOTATION_BODY_LIMIT = 2000;
export const ANNOTATION_BATCH_SIZE = 30;

export type AnnotationAnchor = {
  chapterNumber: number;
  editionId: string;
  start: number;
  end: number;
  quote: string;
};

export type AnnotationDraft = AnnotationAnchor & { id: string; body: string };
export type SavedAnnotation = AnnotationDraft & { version: number; published: boolean };
export type PublicAnnotation = AnnotationDraft & { name: string; updatedAt: string };

export function matchesAnnotation(anchor: AnnotationAnchor, characters: readonly string[]) {
  return anchor.start >= 0 && anchor.end > anchor.start && anchor.end <= characters.length && characters.slice(anchor.start, anchor.end).join('') === anchor.quote;
}
