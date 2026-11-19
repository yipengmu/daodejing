CREATE TABLE "ReadingAnnotation" (
    "accountId" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "editionId" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReadingAnnotation_pkey" PRIMARY KEY ("accountId", "id"),
    CONSTRAINT "ReadingAnnotation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReadingAnnotation_chapterNumber_editionId_fkey" FOREIGN KEY ("chapterNumber", "editionId") REFERENCES "ChapterText"("chapterNumber", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReadingAnnotation_range_check" CHECK ("start" >= 0 AND "end" > "start" AND ("deleted" OR "end" - "start" = char_length("quote"))),
    CONSTRAINT "ReadingAnnotation_publication_check" CHECK (NOT "published" OR (NOT "deleted" AND length(btrim("body")) > 0)),
    CONSTRAINT "ReadingAnnotation_deletion_check" CHECK (NOT "deleted" OR ("body" = '' AND "quote" = ''))
);

CREATE INDEX "ReadingAnnotation_accountId_chapterNumber_editionId_deleted_idx"
    ON "ReadingAnnotation"("accountId", "chapterNumber", "editionId", "deleted");
CREATE INDEX "ReadingAnnotation_chapterNumber_editionId_published_updatedAt_idx"
    ON "ReadingAnnotation"("chapterNumber", "editionId", "published", "updatedAt");
