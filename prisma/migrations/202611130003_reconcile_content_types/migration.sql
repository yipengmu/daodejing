ALTER TABLE "ContentItem" DROP CONSTRAINT "ContentItem_contentType_check";

UPDATE "ContentItem"
SET "contentType" = CASE "contentType"
  WHEN 'COMMUNITY' THEN 'FIELD_NOTE'
  WHEN 'EDITORIAL_MATERIAL' THEN 'LEAD_READING'
  ELSE "contentType"
END;

ALTER TABLE "ContentItem" ALTER COLUMN "contentType" SET DEFAULT 'FIELD_NOTE';
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_contentType_check"
  CHECK ("contentType" IN ('FIELD_NOTE', 'AGENT_NOTES', 'LEAD_READING'));

ALTER TABLE "ContentItem" DROP CONSTRAINT "ContentItem_author_or_import_check";
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_author_or_import_check" CHECK (
  ("authorId" IS NOT NULL AND "importTokenHash" IS NULL)
  OR ("authorId" IS NULL AND "importData" IS NOT NULL AND "importTokenHash" IS NOT NULL)
);
