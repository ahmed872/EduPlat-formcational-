-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "miniCooldownMinutes" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "cooldownBucket" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_gameId_studentId_cooldownBucket_key" ON "GameSession"("gameId", "studentId", "cooldownBucket");
