/**
 * Operator-only: issue a one-time password reset link for any account,
 * typically the teacher/admin account (which can't be reset from the
 * teacher UI, and no email provider is integrated). Requires shell access
 * to the server and its DATABASE_URL; the link is printed to this terminal
 * only — not logged, not stored in plain form.
 *
 *   npm run password:reset-link -- teacher@example.com
 */
import { PrismaClient } from "@prisma/client";
import { ADMIN_ISSUED_TOKEN_TTL_MINUTES, issuePasswordResetToken, normalizeEmail, resetPathForToken } from "../src/lib/business/password-reset";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run password:reset-link -- <email>");
    process.exit(2);
  }
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) {
    console.error("No account with that email.");
    process.exit(1);
  }
  if (user.status === "BLOCKED") {
    console.error("That account is blocked; unblock it first.");
    process.exit(1);
  }
  const { token, expiresAt } = await issuePasswordResetToken(prisma, {
    userId: user.id,
    ttlMinutes: ADMIN_ISSUED_TOKEN_TTL_MINUTES,
  });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "ISSUE_PASSWORD_RESET_LINK_CLI",
      entityType: "User",
      entityId: user.id,
      metadata: { expiresAt: expiresAt.toISOString() },
    },
  });
  const origin = process.env.APP_BASE_URL || process.env.AUTH_URL;
  const pathPart = resetPathForToken(token);
  console.log(origin ? `${new URL(origin).origin}${pathPart}` : `<your site origin>${pathPart}`);
  console.log(`Single use; expires ${expiresAt.toISOString()}. Hand it to the account owner directly.`);
}

main()
  .catch((error) => {
    console.error("Failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
