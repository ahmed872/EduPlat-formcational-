/*
  Warnings:

  - Added the required column `originalAmountCents` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "grantedById" TEXT,
ADD COLUMN     "promoRedemptionId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "originalAmountCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "PromoApplicableContent" ADD COLUMN     "lessonId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "promoCodeId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_promoRedemptionId_fkey" FOREIGN KEY ("promoRedemptionId") REFERENCES "PromoRedemption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoApplicableContent" ADD CONSTRAINT "PromoApplicableContent_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
