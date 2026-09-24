-- AlterTable
ALTER TABLE "ExperimentAttempt" ADD COLUMN     "endedAt" TIMESTAMP(3);

-- Existing completed attempts are closed attempts too.
UPDATE "ExperimentAttempt" SET "endedAt" = "completedAt" WHERE "completedAt" IS NOT NULL;
