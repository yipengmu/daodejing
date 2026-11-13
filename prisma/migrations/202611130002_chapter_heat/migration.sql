CREATE TABLE "ChapterRead" (
    "id" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "readerKey" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "readDay" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChapterRead_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChapterRead_chapterNumber_fkey" FOREIGN KEY ("chapterNumber") REFERENCES "Chapter"("number") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChapterRead_chapterNumber_readerKey_readDay_key" ON "ChapterRead"("chapterNumber", "readerKey", "readDay");
CREATE UNIQUE INDEX "ChapterRead_chapterNumber_visitorHash_readDay_key" ON "ChapterRead"("chapterNumber", "visitorHash", "readDay");
CREATE INDEX "ChapterRead_chapterNumber_createdAt_idx" ON "ChapterRead"("chapterNumber", "createdAt");
