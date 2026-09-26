import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ForbiddenError } from "@/lib/rbac";
import { markLoginAttemptSucceeded, reserveLoginAttempt } from "@/lib/business/security";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/business/password";

/**
 * Password recovery.
 *
 * - A reset token is 32 random bytes (base64url). Only its SHA-256 hash
 *   is stored, so a database leak does not yield usable links. SHA-256
 *   (not bcrypt) is right here: the token has 256 bits of entropy, so it
 *   can't be brute-forced, and a fast hash lets us look it up by value.
 * - Tokens are short-lived, single-use (claimed with a conditional update,
 *   so two concurrent submissions can't both win), and superseded by any
 *   newer token for the same account.
 * - A successful reset bumps User.sessionVersion, which ends every
 *   existing session (see session-validity.ts).
 * - Self-service requests always get the same answer whether or not the
 *   account exists, and are rate-limited per email hash.
 */

/** Self-service ("forgot password") link lifetime. */
export const SELF_SERVICE_TOKEN_TTL_MINUTES = 30;
/** Teacher/admin-issued link lifetime (delivered by hand, e.g. by phone). */
export const ADMIN_ISSUED_TOKEN_TTL_MINUTES = 4 * 60;
/** Self-service requests allowed per email per window. */
export const RESET_REQUEST_LIMIT = 3;
export const RESET_REQUEST_WINDOW_MINUTES = 15;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const INVALID_TOKEN_MESSAGE = "رابط إعادة التعيين غير صالح أو انتهت صلاحيته أو استُخدم من قبل. اطلب رابطًا جديدًا.";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashEmail(email: string): string {
  return createHash("sha256").update(`password-reset:${normalizeEmail(email)}`, "utf8").digest("hex");
}

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The path a reset link points to. The token travels in the URL fragment,
 * which browsers never send to the server, so it can't end up in proxy
 * access logs or a Referer header. */
export function resetPathForToken(token: string): string {
  return `/reset-password#token=${token}`;
}

/**
 * Records a self-service request and reports whether it is over the limit.
 * Counted per email hash whether or not an account exists, under an
 * advisory lock so concurrent requests can't all slip under the limit.
 */
export async function recordResetRequest(
  prisma: PrismaClient,
  params: { email: string; now?: Date },
): Promise<{ limited: boolean }> {
  const now = params.now ?? new Date();
  const emailHash = hashEmail(params.email);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reset-request:${emailHash}`}))`;
    const windowStart = new Date(now.getTime() - RESET_REQUEST_WINDOW_MINUTES * 60_000);
    const recent = await tx.passwordResetRequest.count({
      // No upper bound: a request that took the lock first may carry a
      // slightly later timestamp than this one and must still count.
      where: { emailHash, createdAt: { gt: windowStart } },
    });
    if (recent >= RESET_REQUEST_LIMIT) return { limited: true };
    await tx.passwordResetRequest.create({ data: { emailHash, createdAt: now } });
    return { limited: false };
  });
}

/** Creates a fresh token for the user, replacing any unused one. */
export async function issuePasswordResetToken(
  prisma: PrismaClient,
  params: { userId: string; ttlMinutes: number; issuedById?: string; now?: Date },
): Promise<{ token: string; expiresAt: Date }> {
  const now = params.now ?? new Date();
  const token = generateResetToken();
  const expiresAt = new Date(now.getTime() + params.ttlMinutes * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({ where: { userId: params.userId, usedAt: null } });
    await tx.passwordResetToken.create({
      data: {
        userId: params.userId,
        tokenHash: hashResetToken(token),
        expiresAt,
        issuedById: params.issuedById ?? null,
        createdAt: now,
      },
    });
    if (params.issuedById) {
      await tx.auditLog.create({
        data: {
          actorId: params.issuedById,
          action: "ISSUE_PASSWORD_RESET_LINK",
          entityType: "User",
          entityId: params.userId,
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      });
    }
  });
  return { token, expiresAt };
}

export type ResetDelivery = (message: { to: string; name: string; resetPath: string; expiresAt: Date }) => Promise<void>;

/**
 * Self-service request. Returns nothing: the caller shows the same message
 * whatever happens here. Blocked accounts and unknown emails get no token.
 */
export async function requestPasswordReset(
  prisma: PrismaClient,
  params: { email: string; deliver: ResetDelivery; now?: Date },
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(params.email) } });
  if (!user || user.status === "BLOCKED") return;
  const { token, expiresAt } = await issuePasswordResetToken(prisma, {
    userId: user.id,
    ttlMinutes: SELF_SERVICE_TOKEN_TTL_MINUTES,
    now: params.now,
  });
  await params.deliver({ to: user.email, name: user.name, resetPath: resetPathForToken(token), expiresAt });
}

/**
 * Teacher/admin-issued link for a student or parent who can't receive
 * email. The link is shown once to the teacher, who hands it over through
 * a trusted channel. Teacher accounts can't be targeted from here.
 */
export async function issueResetLinkForUser(
  prisma: PrismaClient,
  params: { targetUserId: string; actorUserId: string; now?: Date },
): Promise<{ resetPath: string; expiresAt: Date }> {
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.actorUserId } }),
    prisma.user.findUnique({ where: { id: params.targetUserId } }),
  ]);
  if (!actor || actor.role !== "TEACHER_ADMIN" || actor.status === "BLOCKED") {
    throw new ForbiddenError("غير مسموح");
  }
  if (!target) throw new Error("الحساب غير موجود");
  if (target.role === "TEACHER_ADMIN") {
    throw new ForbiddenError("لا يمكن إنشاء رابط لحساب معلم/إدارة من هنا");
  }
  if (target.status === "BLOCKED") {
    throw new Error("الحساب محظور — ارفع الحظر أولًا");
  }
  const { token, expiresAt } = await issuePasswordResetToken(prisma, {
    userId: target.id,
    ttlMinutes: ADMIN_ISSUED_TOKEN_TTL_MINUTES,
    issuedById: actor.id,
    now: params.now,
  });
  return { resetPath: resetPathForToken(token), expiresAt };
}

export type ResetResult = { ok: true } | { ok: false; code: "INVALID_TOKEN" | "WEAK_PASSWORD"; message: string };

/**
 * Consumes a token and sets the new password. Any unknown, malformed,
 * expired, already-used or superseded token — or one for an account that
 * has since been blocked — gets the same answer.
 */
export async function resetPasswordWithToken(
  prisma: PrismaClient,
  params: { token: string; newPassword: string; now?: Date },
): Promise<ResetResult> {
  const now = params.now ?? new Date();
  const invalid: ResetResult = { ok: false, code: "INVALID_TOKEN", message: INVALID_TOKEN_MESSAGE };
  if (!TOKEN_PATTERN.test(params.token)) return invalid;

  const tokenHash = hashResetToken(params.token);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt <= now || row.user.status === "BLOCKED") return invalid;

  // Checked before the token is claimed, so a weak password doesn't burn it.
  const policyError = passwordPolicyError(params.newPassword, { email: row.user.email });
  if (policyError) return { ok: false, code: "WEAK_PASSWORD", message: policyError };

  const passwordHash = await hashPassword(params.newPassword);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return invalid;
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, passwordChangedAt: now, sessionVersion: { increment: 1 } },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: row.userId, usedAt: null } });
    await tx.auditLog.create({
      data: {
        actorId: row.userId,
        action: "PASSWORD_RESET",
        entityType: "User",
        entityId: row.userId,
        metadata: { via: row.issuedById ? "ADMIN_ISSUED_LINK" : "SELF_SERVICE_LINK" },
      },
    });
    return { ok: true } as const;
  });
}

export type ChangeResult =
  | { ok: true }
  | { ok: false; code: "WRONG_PASSWORD" | "RATE_LIMITED" | "WEAK_PASSWORD" | "SAME_PASSWORD"; message: string };

/**
 * Signed-in password change. Requires the current password; wrong guesses
 * count toward the same per-email lockout as the login form. Ends every
 * session, including the current one (the caller signs the user out).
 */
export async function changePassword(
  prisma: PrismaClient,
  params: { userId: string; currentPassword: string; newPassword: string; now?: Date },
): Promise<ChangeResult> {
  const now = params.now ?? new Date();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId } });
  const attemptId = await reserveLoginAttempt(prisma, user.email, now);
  if (!attemptId) {
    return { ok: false, code: "RATE_LIMITED", message: "محاولات خاطئة كثيرة. انتظر قليلًا ثم أعد المحاولة." };
  }
  const currentOk = await verifyPassword(params.currentPassword, user.passwordHash);
  if (!currentOk) {
    return { ok: false, code: "WRONG_PASSWORD", message: "كلمة المرور الحالية غير صحيحة" };
  }
  await markLoginAttemptSucceeded(prisma, attemptId);
  const policyError = passwordPolicyError(params.newPassword, { email: user.email });
  if (policyError) return { ok: false, code: "WEAK_PASSWORD", message: policyError };
  if (await verifyPassword(params.newPassword, user.passwordHash)) {
    return { ok: false, code: "SAME_PASSWORD", message: "كلمة المرور الجديدة يجب أن تختلف عن الحالية" };
  }

  const passwordHash = await hashPassword(params.newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: now, sessionVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.auditLog.create({
      data: { actorId: user.id, action: "PASSWORD_CHANGE", entityType: "User", entityId: user.id },
    }),
  ]);
  return { ok: true };
}
