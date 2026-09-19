import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import {
  awardCustomAchievement,
  computeStudentMetrics,
  evaluateAchievementsForStudent,
  getStudentAchievements,
} from "@/lib/business/achievements";

beforeEach(async () => {
  await resetDatabase();
});

async function createAutoAchievement(metric: string, threshold: number, overrides: { code?: string } = {}) {
  return prisma.achievement.create({
    data: {
      code: overrides.code ?? `AUTO_${metric}_${threshold}`,
      title: `إنجاز ${metric}`,
      criteriaJson: { metric, threshold },
      isCustom: false,
    },
  });
}

async function createCustomAchievement() {
  return prisma.achievement.create({
    data: {
      code: "SPECIAL",
      title: "تقدير خاص",
      criteriaJson: { metric: "MANUAL", threshold: 0 },
      isCustom: true,
    },
  });
}

describe("computeStudentMetrics", () => {
  it("reads GAME_POINTS from StudentProfile.points and defaults others to zero for a fresh student", async () => {
    const student = await createStudent();
    await prisma.studentProfile.update({ where: { id: student.id }, data: { points: 55 } });

    const metrics = await computeStudentMetrics(prisma, student.id);
    expect(metrics.GAME_POINTS).toBe(55);
    expect(metrics.STREAK_DAYS).toBe(0);
    expect(metrics.LESSONS_COMPLETED).toBe(0);
    expect(metrics.QUIZZES_PASSED).toBe(0);
    expect(metrics.EXPERIMENTS_COMPLETED).toBe(0);
  });

  it("uses the student's longestStreak, not currentStreak, for STREAK_DAYS", async () => {
    const student = await createStudent();
    await prisma.streak.create({
      data: { studentId: student.id, currentStreak: 1, longestStreak: 9 },
    });

    const metrics = await computeStudentMetrics(prisma, student.id);
    expect(metrics.STREAK_DAYS).toBe(9);
  });
});

describe("evaluateAchievementsForStudent", () => {
  it("awards an achievement once the real metric meets its threshold", async () => {
    const student = await createStudent();
    const achievement = await createAutoAchievement("GAME_POINTS", 50);
    await prisma.studentProfile.update({ where: { id: student.id }, data: { points: 60 } });

    const newlyEarned = await evaluateAchievementsForStudent(prisma, student.id);

    expect(newlyEarned.map((a) => a.id)).toEqual([achievement.id]);
    const row = await prisma.studentAchievement.findUnique({
      where: { studentId_achievementId: { studentId: student.id, achievementId: achievement.id } },
    });
    expect(row).not.toBeNull();
  });

  it("does not award an achievement whose threshold is not yet met", async () => {
    const student = await createStudent();
    await createAutoAchievement("GAME_POINTS", 100);
    await prisma.studentProfile.update({ where: { id: student.id }, data: { points: 40 } });

    const newlyEarned = await evaluateAchievementsForStudent(prisma, student.id);
    expect(newlyEarned).toHaveLength(0);
  });

  it("never re-awards (or re-notifies for) an achievement the student already holds", async () => {
    const student = await createStudent();
    await createAutoAchievement("GAME_POINTS", 10);
    await prisma.studentProfile.update({ where: { id: student.id }, data: { points: 20 } });

    const first = await evaluateAchievementsForStudent(prisma, student.id);
    expect(first).toHaveLength(1);

    const second = await evaluateAchievementsForStudent(prisma, student.id);
    expect(second).toHaveLength(0);

    const count = await prisma.studentAchievement.count({ where: { studentId: student.id } });
    expect(count).toBe(1);
  });

  it("sends a real notification when an achievement unlocks", async () => {
    const student = await createStudent({});
    const studentProfile = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: student.id },
    });
    await createAutoAchievement("GAME_POINTS", 5);
    await prisma.studentProfile.update({ where: { id: student.id }, data: { points: 10 } });

    await evaluateAchievementsForStudent(prisma, student.id);

    const notification = await prisma.notification.findFirst({
      where: { userId: studentProfile.userId, type: "ACHIEVEMENT_UNLOCKED" },
    });
    expect(notification).not.toBeNull();
  });

  it("never auto-awards a custom (isCustom) achievement, however high the metrics are", async () => {
    const student = await createStudent();
    const custom = await createCustomAchievement();
    await prisma.studentProfile.update({ where: { id: student.id }, data: { points: 999999 } });

    await evaluateAchievementsForStudent(prisma, student.id);

    const row = await prisma.studentAchievement.findUnique({
      where: { studentId_achievementId: { studentId: student.id, achievementId: custom.id } },
    });
    expect(row).toBeNull();
  });

  it("ignores an achievement with malformed criteria instead of ever unlocking it", async () => {
    const student = await createStudent();
    const malformed = await prisma.achievement.create({
      data: { code: "BROKEN", title: "معطوب", criteriaJson: { foo: "bar" }, isCustom: false },
    });
    await prisma.studentProfile.update({ where: { id: student.id }, data: { points: 999999 } });

    await evaluateAchievementsForStudent(prisma, student.id);

    const row = await prisma.studentAchievement.findUnique({
      where: { studentId_achievementId: { studentId: student.id, achievementId: malformed.id } },
    });
    expect(row).toBeNull();
  });
});

describe("awardCustomAchievement", () => {
  it("grants a custom achievement by explicit teacher action", async () => {
    const student = await createStudent();
    const custom = await createCustomAchievement();

    await awardCustomAchievement(prisma, { achievementId: custom.id, studentId: student.id });

    const row = await prisma.studentAchievement.findUnique({
      where: { studentId_achievementId: { studentId: student.id, achievementId: custom.id } },
    });
    expect(row).not.toBeNull();
  });

  it("rejects awarding a non-custom (automatic) achievement manually", async () => {
    const student = await createStudent();
    const auto = await createAutoAchievement("GAME_POINTS", 10);

    await expect(
      awardCustomAchievement(prisma, { achievementId: auto.id, studentId: student.id }),
    ).rejects.toThrow(/آلي/);
  });

  it("rejects awarding the same custom achievement to the same student twice", async () => {
    const student = await createStudent();
    const custom = await createCustomAchievement();

    await awardCustomAchievement(prisma, { achievementId: custom.id, studentId: student.id });
    await expect(
      awardCustomAchievement(prisma, { achievementId: custom.id, studentId: student.id }),
    ).rejects.toThrow(/بالفعل/);
  });
});

describe("getStudentAchievements", () => {
  it("reports earned achievements with an earnedAt date and locked ones with progress", async () => {
    const student = await createStudent();
    const earned = await createAutoAchievement("GAME_POINTS", 10, { code: "EARNED" });
    const locked = await createAutoAchievement("LESSONS_COMPLETED", 5, { code: "LOCKED" });
    await prisma.studentProfile.update({ where: { id: student.id }, data: { points: 20 } });
    await evaluateAchievementsForStudent(prisma, student.id);

    const entries = await getStudentAchievements(prisma, student.id);

    const earnedEntry = entries.find((e) => e.achievement.id === earned.id)!;
    expect(earnedEntry.earnedAt).not.toBeNull();

    const lockedEntry = entries.find((e) => e.achievement.id === locked.id)!;
    expect(lockedEntry.earnedAt).toBeNull();
    expect(lockedEntry.progress).toEqual({ current: 0, threshold: 5 });
  });

  it("reports a custom achievement with no progress bar (null progress)", async () => {
    const student = await createStudent();
    await createCustomAchievement();

    const entries = await getStudentAchievements(prisma, student.id);
    const customEntry = entries.find((e) => e.achievement.isCustom)!;
    expect(customEntry.progress).toBeNull();
  });
});
