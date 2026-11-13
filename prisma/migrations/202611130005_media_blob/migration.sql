CREATE TABLE "MediaBlob" (
    "mediaId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    CONSTRAINT "MediaBlob_pkey" PRIMARY KEY ("mediaId"),
    CONSTRAINT "MediaBlob_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
