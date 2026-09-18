-- AlterTable
ALTER TABLE "Short" ADD COLUMN     "storageProvider" TEXT NOT NULL DEFAULT 'LOCAL_PRIVATE',
ADD COLUMN     "thumbnailUrl" TEXT;
