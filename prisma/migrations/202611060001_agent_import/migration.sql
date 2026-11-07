ALTER TABLE "ContentItem" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "ContentItem" ADD COLUMN "importData" JSONB;
ALTER TABLE "ContentItem" ADD COLUMN "importTokenHash" TEXT;
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_author_or_import_check" CHECK (("authorId" IS NOT NULL AND "importData" IS NULL AND "importTokenHash" IS NULL) OR ("authorId" IS NULL AND "importData" IS NOT NULL AND "importTokenHash" IS NOT NULL));
