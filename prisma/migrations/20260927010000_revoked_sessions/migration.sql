-- Per-session sign-out: a signed-out session's id is recorded so it is
-- refused even if a late response re-issues its cookie. Purely additive.
-- CreateTable
CREATE TABLE "RevokedSession" (
    "sid" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("sid")
);
-- CreateIndex
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
