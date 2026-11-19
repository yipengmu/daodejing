export function chapterChannelPath(chapter: number, fromReader: boolean) {
  return fromReader ? `/read/${chapter}?panel=channel` : `/chapters/${chapter}`;
}
