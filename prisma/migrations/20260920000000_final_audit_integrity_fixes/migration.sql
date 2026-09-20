
-- DropIndex
DROP INDEX "Certificate_studentId_courseId_idx";

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "playDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Announcement_audienceType_audienceRefId_idx" ON "Announcement"("audienceType", "audienceRefId");

-- CreateIndex
CREATE INDEX "CareerExplorationResult_studentId_idx" ON "CareerExplorationResult"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_studentId_courseId_key" ON "Certificate"("studentId", "courseId");

-- CreateIndex
CREATE INDEX "Entitlement_subscriptionId_idx" ON "Entitlement"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_gameId_studentId_playDate_key" ON "GameSession"("gameId", "studentId", "playDate");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "ParentStudent_studentId_idx" ON "ParentStudent"("studentId");

-- CreateIndex
CREATE INDEX "Product_status_stock_idx" ON "Product"("status", "stock");

-- CreateIndex
CREATE INDEX "ReferralReward_referrerStudentId_idx" ON "ReferralReward"("referrerStudentId");

-- CreateIndex
CREATE INDEX "StudyActivitySession_studentId_type_refId_idx" ON "StudyActivitySession"("studentId", "type", "refId");

-- CreateIndex
CREATE INDEX "Subscription_status_expiresAt_idx" ON "Subscription"("status", "expiresAt");

