import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import { PLATFORM_SETTING_KEYS, setPlatformSetting } from "@/lib/platform-settings";
import {
  assertCanModerateUser,
  blockUser,
  getAuditLog,
  isRateLimited,
  recordLoginAttempt,
  unblockUser,
} from "@/lib/business/security";
import { ForbiddenError } from "@/lib/rbac";

beforeEach(async () => {
  await resetDatabase();
});

async function createTeacherUser() {
  return prisma.user.create({
    data: {
      email: `teacher-${Date.now()}-${Math.random()}@test.local`,
      name: "Test Teacher",
      passwordHash: "not-used-in-tests",
      role: "TEACHER_ADMIN",
    },
  });
}

async function studentUser(studentId: string) {
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } });
  return prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
}

describe("isRateLimited", () => {
  it("is not rate limited with no prior attempts", async () => {
    const limited = await isRateLimited(prisma, "nobody@test.local");
    expect(limited).toBe(false);
  });

  it("is not rate limited below the configured failure threshold", async () => {
    await setPlatformSetting(PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 5);
    for (let i = 0; i < 4; i++) {
      await recordLoginAttempt(prisma, { email: "victim@test.local", succeeded: false });
    }
    expect(await isRateLimited(prisma, "victim@test.local")).toBe(false);
  });

  it("becomes rate limited once the failure threshold is reached", async () => {
    await setPlatformSetting(PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 3);
    for (let i = 0; i < 3; i++) {
      await recordLoginAttempt(prisma, { email: "victim2@test.local", succeeded: false });
    }
    expect(await isRateLimited(prisma, "victim2@test.local")).toBe(true);
  });

  it("does not count failures outside the configured rolling window", async () => {
    await setPlatformSetting(PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 2);
    await setPlatformSetting(PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 15);
    const old = new Date("2026-01-01T00:00:00Z");
    await prisma.loginAttempt.create({
      data: { email: "old@test.local", succeeded: false, createdAt: old },
    });
    await prisma.loginAttempt.create({
      data: { email: "old@test.local", succeeded: false, createdAt: old },
    });

    const now = new Date(old.getTime() + 60 * 60_000); // 1 hour later, outside a 15-minute window
    expect(await isRateLimited(prisma, "old@test.local", now)).toBe(false);
  });

  it("is case-insensitive on the email", async () => {
    await setPlatformSetting(PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 1);
    await recordLoginAttempt(prisma, { email: "Mixed@Test.Local", succeeded: false });
    expect(await isRateLimited(prisma, "mixed@test.local")).toBe(true);
  });
});

describe("blockUser / unblockUser", () => {
  it("blocks a user, recording the reason and a real audit log entry", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);
    const teacher = await createTeacherUser();

    const blocked = await blockUser(prisma, {
      userId: user.id,
      reason: "إساءة استخدام",
      blockedById: teacher.id,
    });

    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.blockedReason).toBe("إساءة استخدام");
    expect(blocked.blockedById).toBe(teacher.id);

    const logEntry = await prisma.auditLog.findFirst({
      where: { entityId: user.id, action: "BLOCK_USER" },
    });
    expect(logEntry?.actorId).toBe(teacher.id);
  });

  it("unblocks a user, clearing the block fields and logging it", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);
    const teacher = await createTeacherUser();
    await blockUser(prisma, { userId: user.id, reason: "س", blockedById: teacher.id });

    const unblocked = await unblockUser(prisma, { userId: user.id, actorId: teacher.id });

    expect(unblocked.status).toBe("ACTIVE");
    expect(unblocked.blockedReason).toBeNull();
    const logEntry = await prisma.auditLog.findFirst({
      where: { entityId: user.id, action: "UNBLOCK_USER" },
    });
    expect(logEntry).not.toBeNull();
  });
});

describe("assertCanModerateUser", () => {
  it("allows moderating a STUDENT or PARENT account", () => {
    expect(() => assertCanModerateUser({ role: "STUDENT" })).not.toThrow();
    expect(() => assertCanModerateUser({ role: "PARENT" })).not.toThrow();
  });

  it("never allows moderating a TEACHER_ADMIN account through this path", () => {
    expect(() => assertCanModerateUser({ role: "TEACHER_ADMIN" })).toThrow(ForbiddenError);
  });
});

describe("getAuditLog", () => {
  it("returns entries newest first", async () => {
    const teacher = await createTeacherUser();
    const student = await createStudent();
    const user = await studentUser(student.id);
    await blockUser(prisma, { userId: user.id, reason: "أ", blockedById: teacher.id });
    await unblockUser(prisma, { userId: user.id, actorId: teacher.id });

    const entries = await getAuditLog(prisma);

    expect(entries[0].action).toBe("UNBLOCK_USER");
    expect(entries[1].action).toBe("BLOCK_USER");
  });
});
