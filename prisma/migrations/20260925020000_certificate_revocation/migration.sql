-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedReason" TEXT;

