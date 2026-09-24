-- Lesson attachments move from a free-form "fileUrl" (which could only ever
-- hold a raw, public link) to private storage served through an
-- access-checked route. No code path ever created Attachment rows before
-- this migration, so the table is expected to be empty; if a deployment has
-- hand-inserted rows, stop instead of silently dropping their URLs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Attachment") THEN
    RAISE EXCEPTION 'Attachment has % existing row(s) with raw fileUrl values; migrate them to private storage manually before applying this migration', (SELECT count(*) FROM "Attachment");
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Attachment" DROP COLUMN "fileUrl",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "mimeType" TEXT NOT NULL,
ADD COLUMN     "originalName" TEXT NOT NULL,
ADD COLUMN     "sizeBytes" INTEGER NOT NULL,
ADD COLUMN     "storageKey" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");
