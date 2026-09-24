-- AlterTable
ALTER TABLE "WatchSession" ADD COLUMN     "servedBuckets" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

