-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "lastPhoneResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "accountId" TEXT NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "avatar" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lookupHash" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "recovery" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "lookupHash" TEXT NOT NULL,
    "accountId" TEXT,
    "codeHash" TEXT,
    "providerRef" TEXT,
    "provider" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Edition" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Edition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "ChapterText" (
    "chapterNumber" INTEGER NOT NULL,
    "editionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "explanation" TEXT,
    "source" JSONB NOT NULL,

    CONSTRAINT "ChapterText_pkey" PRIMARY KEY ("chapterNumber","editionId")
);

-- CreateTable
CREATE TABLE "ChapterChannel" (
    "id" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,

    CONSTRAINT "ChapterChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dojo" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" VARCHAR(160) NOT NULL,
    "province" TEXT NOT NULL DEFAULT '浙江省',
    "city" TEXT NOT NULL DEFAULT '杭州市',
    "district" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "schedule" TEXT,
    "welcome" BOOLEAN NOT NULL DEFAULT true,
    "publicContact" TEXT,
    "signupUrl" TEXT,
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "crs" TEXT NOT NULL DEFAULT 'GCJ-02',
    "poiId" TEXT,
    "poiName" TEXT,
    "poiConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "navigationQuery" TEXT,
    "sourcePrivate" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dojo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatheringSubmission" (
    "id" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "leadReader" VARCHAR(160) NOT NULL,
    "leadReaderId" TEXT,
    "dojoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatheringSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporaryPlace" (
    "id" TEXT NOT NULL,
    "gatheringId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "crs" TEXT NOT NULL DEFAULT 'GCJ-02',
    "poiId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporaryPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "publicName" VARCHAR(80) NOT NULL,
    "publicAvatar" INTEGER NOT NULL DEFAULT 0,
    "sourceUrl" TEXT,
    "gatheringId" TEXT,
    "dojoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "acknowledgementVersion" TEXT NOT NULL DEFAULT 'publication-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentLike" (
    "contentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentLike_pkey" PRIMARY KEY ("contentId","accountId")
);

-- CreateTable
CREATE TABLE "ContentComment" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentView" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "readerKey" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "readDay" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exposure" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "readDay" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exposure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contentId" TEXT,
    "objectKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "body" VARCHAR(4000) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Profile_displayName_idx" ON "Profile"("displayName");

-- CreateIndex
CREATE INDEX "AuthIdentity_accountId_idx" ON "AuthIdentity"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_kind_lookupHash_key" ON "AuthIdentity"("kind", "lookupHash");

-- CreateIndex
CREATE INDEX "Verification_lookupHash_purpose_createdAt_idx" ON "Verification"("lookupHash", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "RateBucket_expiresAt_idx" ON "RateBucket"("expiresAt");

-- CreateIndex
CREATE INDEX "ChapterText_editionId_idx" ON "ChapterText"("editionId");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterChannel_chapterNumber_key" ON "ChapterChannel"("chapterNumber");

-- CreateIndex
CREATE INDEX "Dojo_status_province_city_idx" ON "Dojo"("status", "province", "city");

-- CreateIndex
CREATE INDEX "Dojo_ownerId_updatedAt_idx" ON "Dojo"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "GatheringSubmission_chapterNumber_status_submittedAt_idx" ON "GatheringSubmission"("chapterNumber", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "GatheringSubmission_submitterId_submittedAt_idx" ON "GatheringSubmission"("submitterId", "submittedAt");

-- CreateIndex
CREATE INDEX "GatheringSubmission_dojoId_idx" ON "GatheringSubmission"("dojoId");

-- CreateIndex
CREATE INDEX "GatheringSubmission_leadReaderId_idx" ON "GatheringSubmission"("leadReaderId");

-- CreateIndex
CREATE UNIQUE INDEX "TemporaryPlace_gatheringId_key" ON "TemporaryPlace"("gatheringId");

-- CreateIndex
CREATE INDEX "TemporaryPlace_province_city_idx" ON "TemporaryPlace"("province", "city");

-- CreateIndex
CREATE INDEX "ContentItem_chapterNumber_status_viewsCount_createdAt_id_idx" ON "ContentItem"("chapterNumber", "status", "viewsCount", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ContentItem_chapterNumber_status_createdAt_id_idx" ON "ContentItem"("chapterNumber", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ContentItem_authorId_createdAt_idx" ON "ContentItem"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentItem_gatheringId_idx" ON "ContentItem"("gatheringId");

-- CreateIndex
CREATE INDEX "ContentItem_dojoId_idx" ON "ContentItem"("dojoId");

-- CreateIndex
CREATE INDEX "ContentLike_accountId_idx" ON "ContentLike"("accountId");

-- CreateIndex
CREATE INDEX "ContentComment_contentId_status_createdAt_idx" ON "ContentComment"("contentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentComment_authorId_idx" ON "ContentComment"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentView_contentId_readerKey_readDay_key" ON "ContentView"("contentId", "readerKey", "readDay");

-- CreateIndex
CREATE UNIQUE INDEX "ContentView_contentId_visitorHash_readDay_key" ON "ContentView"("contentId", "visitorHash", "readDay");

-- CreateIndex
CREATE UNIQUE INDEX "Exposure_contentId_visitorHash_readDay_key" ON "Exposure"("contentId", "visitorHash", "readDay");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_objectKey_key" ON "MediaAsset"("objectKey");

-- CreateIndex
CREATE INDEX "MediaAsset_ownerId_status_idx" ON "MediaAsset"("ownerId", "status");

-- CreateIndex
CREATE INDEX "MediaAsset_contentId_status_idx" ON "MediaAsset"("contentId", "status");

-- CreateIndex
CREATE INDEX "Feedback_accountId_createdAt_idx" ON "Feedback"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_objectId_createdAt_idx" ON "AuditEvent"("objectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterText" ADD CONSTRAINT "ChapterText_chapterNumber_fkey" FOREIGN KEY ("chapterNumber") REFERENCES "Chapter"("number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterText" ADD CONSTRAINT "ChapterText_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterChannel" ADD CONSTRAINT "ChapterChannel_chapterNumber_fkey" FOREIGN KEY ("chapterNumber") REFERENCES "Chapter"("number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dojo" ADD CONSTRAINT "Dojo_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringSubmission" ADD CONSTRAINT "GatheringSubmission_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringSubmission" ADD CONSTRAINT "GatheringSubmission_leadReaderId_fkey" FOREIGN KEY ("leadReaderId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringSubmission" ADD CONSTRAINT "GatheringSubmission_chapterNumber_fkey" FOREIGN KEY ("chapterNumber") REFERENCES "Chapter"("number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringSubmission" ADD CONSTRAINT "GatheringSubmission_dojoId_fkey" FOREIGN KEY ("dojoId") REFERENCES "Dojo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryPlace" ADD CONSTRAINT "TemporaryPlace_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "GatheringSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_chapterNumber_fkey" FOREIGN KEY ("chapterNumber") REFERENCES "Chapter"("number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "GatheringSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_dojoId_fkey" FOREIGN KEY ("dojoId") REFERENCES "Dojo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentLike" ADD CONSTRAINT "ContentLike_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentLike" ADD CONSTRAINT "ContentLike_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentComment" ADD CONSTRAINT "ContentComment_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentComment" ADD CONSTRAINT "ContentComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentView" ADD CONSTRAINT "ContentView_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exposure" ADD CONSTRAINT "Exposure_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

