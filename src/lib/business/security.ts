import type { PrismaClient } from "@prisma/client";
import { getPlatformSetting, PLATFORM_SETTING_KEYS } from "@/lib/platform-settings";
import { ForbiddenError } from "@/lib/rbac";

export async function recordLoginAttempt(
  prisma: PrismaClient,
  params: { email: string; succeeded: boolean },
) {
  return prisma.loginAttempt.create({
    data: { email: params.email.toLowerCase(), succeeded: params.succeeded },
  });
}

/**
 * Real brute-force throttling: counts FAILED attempts for this exact
 * email within a configurable rolling window (default 15 minutes) —
 * a single successful login does not reset the window early, and a
 * blocked email stays rate-limited until enough time passes, matching
 * a standard lockout policy rather than a token bucket that could be
 * gamed by interleaving one success among many guesses.
 */
export async function isRateLimited(
  prisma: PrismaClient,
  email: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [maxAttempts, windowMinutes] = await Promise.all([
    getPlatformSetting<number>(PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS),
    getPlatformSetting<number>(PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_WINDOW_MINUTES),
  ]);

  const windowStart = new Date(now.getTime() - windowMinutes * 60_000);
  const failedCount = await prisma.loginAttempt.count({
    where: {
      email: email.toLowerCase(),
      succeeded: false,
      createdAt: { gte: windowStart, lte: now },
    },
  });

  return failedCount >= maxAttempts;
}

/**
 * The only path that sets User.status to BLOCKED — enforced already at
 * sign-in (auth.ts's authorize() rejects a BLOCKED user), this is simply
 * the first real way to ever set that status. Writes a genuine AuditLog
 * row, the same accountability trail confirmPayment()/rejectPayment()
 * already use for financial actions.
 */
export async function blockUser(
  prisma: PrismaClient,
  params: { userId: string; reason: string; blockedById: string },
) {
  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: params.userId },
      data: {
        status: "BLOCKED",
        blockedReason: params.reason,
        blockedAt: new Date(),
        blockedById: params.blockedById,
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId: params.blockedById,
        action: "BLOCK_USER",
        entityType: "User",
        entityId: params.userId,
        metadata: { reason: params.reason },
      },
    }),
  ]);
  return updated;
}

export async function unblockUser(
  prisma: PrismaClient,
  params: { userId: string; actorId: string },
) {
  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: params.userId },
      data: { status: "ACTIVE", blockedReason: null, blockedAt: null, blockedById: null },
    }),
    prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: "UNBLOCK_USER",
        entityType: "User",
        entityId: params.userId,
      },
    }),
  ]);
  return updated;
}

/**
 * Guards the moderation endpoints themselves — a teacher/admin can
 * never block another teacher/admin account through this path (avoids
 * a compromised or malicious admin account locking out every other
 * admin); only STUDENT/PARENT accounts are moderatable here.
 */
export function assertCanModerateUser(target: { role: string }) {
  if (target.role === "TEACHER_ADMIN") {
    throw new ForbiddenError("لا يمكن حظر حساب معلم/إدارة من هنا");
  }
}

export async function getAuditLog(
  prisma: PrismaClient,
  params: { limit?: number } = {},
) {
  return prisma.auditLog.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 100,
  });
}
