import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createParent, createStudent, createTeacher } from "@/test/factories";
import {
  ADMIN_ISSUED_TOKEN_TTL_MINUTES,
  RESET_REQUEST_LIMIT,
  RESET_REQUEST_WINDOW_MINUTES,
  SELF_SERVICE_TOKEN_TTL_MINUTES,
  changePassword,
  generateResetToken,
  hashResetToken,
  issueResetLinkForUser,
  recordResetRequest,
  requestPasswordReset,
  resetPasswordWithToken,
  type ResetDelivery,
} from "@/lib/business/password-reset";
import { PASSWORD_MAX_BYTES, hashPassword, passwordPolicyError } from "@/lib/business/password";
import { SESSION_MAX_AGE_SECONDS, isSessionStillValid, revokeSession } from "@/lib/business/session-validity";
import { blockUser } from "@/lib/business/security";
import { ForbiddenError } from "@/lib/rbac";

beforeEach(async () => {
  await resetDatabase();
});

const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "brand-new-pass-456";

async function userWithPassword(role: "STUDENT" | "PARENT" | "TEACHER_ADMIN" = "STUDENT") {
  const base =
    role === "STUDENT"
      ? (await prisma.studentProfile.findUniqueOrThrow({ where: { id: (await createStudent()).id }, include: { user: true } })).user
      : role === "PARENT"
        ? (await prisma.parentProfile.findUniqueOrThrow({ where: { id: (await createParent()).id }, include: { user: true } })).user
        : await createTeacher();
  return prisma.user.update({ where: { id: base.id }, data: { passwordHash: await hashPassword(OLD_PASSWORD) } });
}

/** Requests a self-service reset and returns the token the "email" carried. */
async function requestAndCapture(email: string, now?: Date): Promise<string | null> {
  let captured: string | null = null;
  const deliver: ResetDelivery = async ({ resetPath }) => {
    captured = resetPath.split("#token=")[1];
  };
  await requestPasswordReset(prisma, { email, deliver, now });
  return captured;
}

describe("password policy", () => {
  it("uses the registration minimum and refuses what bcrypt would silently truncate", () => {
    expect(passwordPolicyError("short")).toMatch(/8/);
    expect(passwordPolicyError("        ")).not.toBeNull();
    expect(passwordPolicyError("a".repeat(PASSWORD_MAX_BYTES))).toBeNull();
    expect(passwordPolicyError("a".repeat(PASSWORD_MAX_BYTES + 1))).toMatch(/طويلة/);
    // 37 Arabic letters are 74 UTF-8 bytes: over bcrypt's limit although only 37 characters.
    expect(passwordPolicyError("ب".repeat(37))).toMatch(/طويلة/);
    expect(passwordPolicyError("Someone@Test.local", { email: "someone@test.local" })).toMatch(/البريد/);
    expect(passwordPolicyError("a-good-password")).toBeNull();
  });
});

describe("self-service reset", () => {
  it("resets the password with a valid token and stores only a bcrypt hash", async () => {
    const user = await userWithPassword();
    const token = await requestAndCapture(user.email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const result = await resetPasswordWithToken(prisma, { token: token!, newPassword: NEW_PASSWORD });
    expect(result).toEqual({ ok: true });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).not.toContain(NEW_PASSWORD);
    expect(after.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(NEW_PASSWORD, after.passwordHash)).toBe(true);
    expect(await bcrypt.compare(OLD_PASSWORD, after.passwordHash)).toBe(false);
    expect(after.sessionVersion).toBe(1);
    expect(after.passwordChangedAt).not.toBeNull();

    const audit = await prisma.auditLog.findMany({ where: { entityId: user.id, action: "PASSWORD_RESET" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].metadata)).not.toContain(token!);
  });

  it("never stores the raw token", async () => {
    const user = await userWithPassword();
    const token = (await requestAndCapture(user.email))!;
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashResetToken(token));
    expect(rows[0].tokenHash).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBe(SELF_SERVICE_TOKEN_TTL_MINUTES * 60_000);
  });

  it("refuses an expired token and leaves the password unchanged", async () => {
    const user = await userWithPassword();
    const issuedAt = new Date("2026-09-01T10:00:00Z");
    const token = (await requestAndCapture(user.email, issuedAt))!;
    const later = new Date(issuedAt.getTime() + (SELF_SERVICE_TOKEN_TTL_MINUTES * 60 + 1) * 1000);

    const result = await resetPasswordWithToken(prisma, { token, newPassword: NEW_PASSWORD, now: later });
    expect(result).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(OLD_PASSWORD, after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(0);
  });

  it("refuses a token that was already used", async () => {
    const user = await userWithPassword();
    const token = (await requestAndCapture(user.email))!;
    expect((await resetPasswordWithToken(prisma, { token, newPassword: NEW_PASSWORD })).ok).toBe(true);

    const replay = await resetPasswordWithToken(prisma, { token, newPassword: "attacker-choice-1" });
    expect(replay).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(NEW_PASSWORD, after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(1);
  });

  it("lets exactly one of several simultaneous submissions of the same token win", async () => {
    const user = await userWithPassword();
    const token = (await requestAndCapture(user.email))!;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => resetPasswordWithToken(prisma, { token, newPassword: `parallel-pass-${i}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.sessionVersion).toBe(1);
  });

  it("gives malformed, unknown and wrong tokens the same answer", async () => {
    const user = await userWithPassword();
    await requestAndCapture(user.email);
    for (const token of ["", "abc", `${"A".repeat(42)}!`, "' OR 1=1 --".padEnd(43, "x"), generateResetToken(), "A".repeat(43)]) {
      const result = await resetPasswordWithToken(prisma, { token, newPassword: NEW_PASSWORD });
      expect(result).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    }
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(OLD_PASSWORD, after.passwordHash)).toBe(true);
  });

  it("invalidates an older link when a newer one is requested", async () => {
    const user = await userWithPassword();
    const first = (await requestAndCapture(user.email))!;
    const second = (await requestAndCapture(user.email))!;
    expect((await resetPasswordWithToken(prisma, { token: first, newPassword: NEW_PASSWORD })).ok).toBe(false);
    expect((await resetPasswordWithToken(prisma, { token: second, newPassword: NEW_PASSWORD })).ok).toBe(true);
  });

  it("does not burn the token on a weak password", async () => {
    const user = await userWithPassword();
    const token = (await requestAndCapture(user.email))!;
    expect(await resetPasswordWithToken(prisma, { token, newPassword: "short" })).toMatchObject({ ok: false, code: "WEAK_PASSWORD" });
    expect(await resetPasswordWithToken(prisma, { token, newPassword: user.email })).toMatchObject({ ok: false, code: "WEAK_PASSWORD" });
    expect((await resetPasswordWithToken(prisma, { token, newPassword: NEW_PASSWORD })).ok).toBe(true);
  });

  it("refuses a token for an account blocked after the link was sent", async () => {
    const user = await userWithPassword();
    const teacher = await createTeacher();
    const token = (await requestAndCapture(user.email))!;
    await blockUser(prisma, { userId: user.id, reason: "test", blockedById: teacher.id });
    expect(await resetPasswordWithToken(prisma, { token, newPassword: NEW_PASSWORD })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
  });
});

describe("user enumeration protection", () => {
  it("issues nothing and sends nothing for unknown or blocked accounts, without failing", async () => {
    const deliver = vi.fn<ResetDelivery>(async () => {});
    await requestPasswordReset(prisma, { email: "nobody@test.local", deliver });

    const blocked = await userWithPassword();
    const teacher = await createTeacher();
    await blockUser(prisma, { userId: blocked.id, reason: "test", blockedById: teacher.id });
    await requestPasswordReset(prisma, { email: blocked.email, deliver });

    expect(deliver).not.toHaveBeenCalled();
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("normalizes the email the same way sign-in does", async () => {
    const user = await userWithPassword();
    const token = await requestAndCapture(`  ${user.email.toUpperCase()} `);
    expect(token).not.toBeNull();
  });

  it("rate-limits known and unknown addresses identically", async () => {
    const user = await userWithPassword();
    const now = new Date("2026-09-01T10:00:00Z");
    for (const email of [user.email, "nobody@test.local"]) {
      const outcomes = [];
      for (let i = 0; i < RESET_REQUEST_LIMIT + 2; i++) outcomes.push((await recordResetRequest(prisma, { email, now })).limited);
      expect(outcomes).toEqual([...Array(RESET_REQUEST_LIMIT).fill(false), true, true]);
    }
    // No email is stored in the clear.
    const rows = await prisma.passwordResetRequest.findMany();
    expect(JSON.stringify(rows)).not.toContain(user.email);
    expect(JSON.stringify(rows)).not.toContain("nobody");
  });

  it("limits per address, and the window slides", async () => {
    const now = new Date("2026-09-01T10:00:00Z");
    for (let i = 0; i < RESET_REQUEST_LIMIT; i++) await recordResetRequest(prisma, { email: "a@test.local", now });
    expect((await recordResetRequest(prisma, { email: "a@test.local", now })).limited).toBe(true);
    expect((await recordResetRequest(prisma, { email: "b@test.local", now })).limited).toBe(false);
    const later = new Date(now.getTime() + RESET_REQUEST_WINDOW_MINUTES * 60_000 + 1000);
    expect((await recordResetRequest(prisma, { email: "a@test.local", now: later })).limited).toBe(false);
  });

  it("can't be raced past the limit", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => recordResetRequest(prisma, { email: "race@test.local" })),
    );
    expect(outcomes.filter((o) => !o.limited)).toHaveLength(RESET_REQUEST_LIMIT);
  });
});

describe("sessions after a password reset or change", () => {
  it("ends every session issued before the reset", async () => {
    const user = await userWithPassword();
    // Tokens issued before sessionVersion existed carry none (= 0).
    expect(await isSessionStillValid(prisma, { userId: user.id })).toBe(true);
    expect(await isSessionStillValid(prisma, { userId: user.id, sessionVersion: 0 })).toBe(true);

    const token = (await requestAndCapture(user.email))!;
    await resetPasswordWithToken(prisma, { token, newPassword: NEW_PASSWORD });

    expect(await isSessionStillValid(prisma, { userId: user.id })).toBe(false);
    expect(await isSessionStillValid(prisma, { userId: user.id, sessionVersion: 0 })).toBe(false);
    expect(await isSessionStillValid(prisma, { userId: user.id, sessionVersion: 1 })).toBe(true);
  });

  it("treats blocked and deleted accounts as signed out", async () => {
    const user = await userWithPassword();
    const teacher = await createTeacher();
    await blockUser(prisma, { userId: user.id, reason: "test", blockedById: teacher.id });
    expect(await isSessionStillValid(prisma, { userId: user.id })).toBe(false);
    expect(await isSessionStillValid(prisma, { userId: "no-such-user" })).toBe(false);
  });
});

describe("sign-out of one session", () => {
  it("revokes exactly that session, idempotently, and prunes rows past the JWT lifetime", async () => {
    const user = await userWithPassword();
    const now = new Date("2026-09-01T10:00:00Z");
    await revokeSession(prisma, { sid: "a", userId: user.id, now });
    await revokeSession(prisma, { sid: "a", userId: user.id, now });
    expect(await isSessionStillValid(prisma, { userId: user.id, sid: "a" })).toBe(false);
    expect(await isSessionStillValid(prisma, { userId: user.id, sid: "b" })).toBe(true);
    expect(await isSessionStillValid(prisma, { userId: user.id })).toBe(true);

    const muchLater = new Date(now.getTime() + (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    await revokeSession(prisma, { sid: "c", userId: user.id, now: muchLater });
    expect((await prisma.revokedSession.findMany()).map((r) => r.sid)).toEqual(["c"]);
  });
});

describe("signed-in password change", () => {
  it("requires the current password and counts wrong guesses toward the login lockout", async () => {
    const user = await userWithPassword();
    const wrong = await changePassword(prisma, { userId: user.id, currentPassword: "not-it-000", newPassword: NEW_PASSWORD });
    expect(wrong).toMatchObject({ ok: false, code: "WRONG_PASSWORD" });
    expect(await prisma.loginAttempt.count({ where: { email: user.email, succeeded: false } })).toBe(1);

    for (let i = 0; i < 5; i++) {
      await changePassword(prisma, { userId: user.id, currentPassword: "not-it-000", newPassword: NEW_PASSWORD });
    }
    // Locked out: even the right current password is refused for now.
    const locked = await changePassword(prisma, { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(locked).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(OLD_PASSWORD, after.passwordHash)).toBe(true);
  });

  it("changes the password, ends all sessions, cancels open reset links and is audited", async () => {
    const user = await userWithPassword();
    const pendingLink = (await requestAndCapture(user.email))!;

    expect(await changePassword(prisma, { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD })).toMatchObject({
      ok: false,
      code: "SAME_PASSWORD",
    });
    expect(await changePassword(prisma, { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: "short" })).toMatchObject({
      ok: false,
      code: "WEAK_PASSWORD",
    });
    expect(await changePassword(prisma, { userId: user.id, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })).toEqual({ ok: true });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(NEW_PASSWORD, after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(1);
    expect(await isSessionStillValid(prisma, { userId: user.id, sessionVersion: 0 })).toBe(false);
    expect((await resetPasswordWithToken(prisma, { token: pendingLink, newPassword: "yet-another-1" })).ok).toBe(false);
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: "PASSWORD_CHANGE" } })).toBe(1);
  });
});

describe("teacher-issued reset links (authorization boundaries)", () => {
  it("lets a teacher issue a single-use link for a student or parent, audit-logged", async () => {
    const teacher = await createTeacher();
    const student = await userWithPassword("STUDENT");
    const parent = await userWithPassword("PARENT");
    const now = new Date();

    for (const target of [student, parent]) {
      const { resetPath, expiresAt } = await issueResetLinkForUser(prisma, { targetUserId: target.id, actorUserId: teacher.id, now });
      expect(expiresAt.getTime() - now.getTime()).toBe(ADMIN_ISSUED_TOKEN_TTL_MINUTES * 60_000);
      const token = resetPath.split("#token=")[1];
      expect((await resetPasswordWithToken(prisma, { token, newPassword: NEW_PASSWORD })).ok).toBe(true);
      expect((await resetPasswordWithToken(prisma, { token, newPassword: NEW_PASSWORD })).ok).toBe(false);
    }
    const audits = await prisma.auditLog.findMany({ where: { actorId: teacher.id, action: "ISSUE_PASSWORD_RESET_LINK" } });
    expect(audits.map((a) => a.entityId).sort()).toEqual([student.id, parent.id].sort());
  });

  it("refuses non-teacher actors, teacher targets, blocked actors and blocked targets", async () => {
    const teacher = await createTeacher();
    const otherTeacher = await userWithPassword("TEACHER_ADMIN");
    const student = await userWithPassword("STUDENT");
    const parent = await userWithPassword("PARENT");

    await expect(issueResetLinkForUser(prisma, { targetUserId: parent.id, actorUserId: student.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(issueResetLinkForUser(prisma, { targetUserId: student.id, actorUserId: parent.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(issueResetLinkForUser(prisma, { targetUserId: otherTeacher.id, actorUserId: teacher.id })).rejects.toBeInstanceOf(ForbiddenError);

    await blockUser(prisma, { userId: parent.id, reason: "test", blockedById: teacher.id });
    await expect(issueResetLinkForUser(prisma, { targetUserId: parent.id, actorUserId: teacher.id })).rejects.toThrow(/محظور/);

    await prisma.user.update({ where: { id: teacher.id }, data: { status: "BLOCKED" } });
    await expect(issueResetLinkForUser(prisma, { targetUserId: student.id, actorUserId: teacher.id })).rejects.toBeInstanceOf(ForbiddenError);

    expect(await prisma.passwordResetToken.count()).toBe(0);
  });
});
