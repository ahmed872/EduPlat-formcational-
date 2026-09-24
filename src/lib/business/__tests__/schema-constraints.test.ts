import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import {
  createCategory,
  createCourse,
  createEntitlement,
  createLesson,
  createStudent,
  createTeacher,
  createVideo,
} from "@/test/factories";
import { setContentStatus } from "@/lib/business/content-status";
import { checkVideoAccess } from "@/lib/business/video-access";
import { createPendingReferralReward } from "@/lib/business/referral";
import { PLATFORM_SETTING_KEYS, setPlatformSetting } from "@/lib/platform-settings";

beforeEach(async () => {
  await resetDatabase();
});

describe("Entitlement lesson/video references are RESTRICT (no silent SET NULL)", () => {
  async function entitledLesson() {
    const student = await createStudent();
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });
    const entitlement = await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    return { student, lesson, video, entitlement };
  }

  it("refuses to delete a lesson that students hold entitlements to, and keeps the grant intact", async () => {
    const { lesson, entitlement } = await entitledLesson();
    await expect(prisma.lesson.delete({ where: { id: lesson.id } })).rejects.toThrow();
    const after = await prisma.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
    expect(after.lessonId).toBe(lesson.id);
    expect(after.videoId).not.toBeNull();
  });

  it("refuses to delete an entitled video", async () => {
    const { video, entitlement } = await entitledLesson();
    await expect(prisma.video.delete({ where: { id: video.id } })).rejects.toThrow();
    const after = await prisma.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
    expect(after.videoId).toBe(video.id);
  });

  it("refuses to delete a course whose lessons are entitled (the lesson cascade is blocked too)", async () => {
    const { lesson } = await entitledLesson();
    await expect(prisma.course.delete({ where: { id: lesson.courseId } })).rejects.toThrow();
    expect(await prisma.lesson.count({ where: { id: lesson.id } })).toBe(1);
  });

  it("still allows deleting a lesson nobody is entitled to", async () => {
    const lesson = await createLesson();
    await createVideo({ lessonId: lesson.id });
    await prisma.lesson.delete({ where: { id: lesson.id } });
    expect(await prisma.lesson.count({ where: { id: lesson.id } })).toBe(0);
  });

  it("does not interfere with archive / unpublish of entitled content, and holders keep access after archive", async () => {
    const { student, lesson, video, entitlement } = await entitledLesson();
    await setContentStatus(prisma, { actorRole: "TEACHER_ADMIN", kind: "LESSON", id: lesson.id, status: "ARCHIVED" });
    expect((await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id })).allowed).toBe(true);
    await setContentStatus(prisma, { actorRole: "TEACHER_ADMIN", kind: "LESSON", id: lesson.id, status: "DRAFT" });
    await setContentStatus(prisma, { actorRole: "TEACHER_ADMIN", kind: "LESSON", id: lesson.id, status: "PUBLISHED" });
    const after = await prisma.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
    expect(after.lessonId).toBe(lesson.id);
    expect(after.revokedAt).toBeNull();
  });
});

describe("User foreign keys", () => {
  it("rejects a course pointing at a user that doesn't exist", async () => {
    const category = await createCategory();
    await expect(
      prisma.course.create({
        data: { categoryId: category.id, teacherId: "no-such-user", title: "x", academicYear: "2026" },
      }),
    ).rejects.toThrow();
  });

  it("refuses to delete a teacher who still owns a course or question bank", async () => {
    const teacher = await createTeacher();
    await createCourse({ teacherId: teacher.id });
    await expect(prisma.user.delete({ where: { id: teacher.id } })).rejects.toThrow();

    const other = await createTeacher();
    await prisma.questionBank.create({ data: { name: "b", teacherId: other.id } });
    await expect(prisma.user.delete({ where: { id: other.id } })).rejects.toThrow();
  });

  it.each([
    ["Entitlement.grantedById", async () => {
      const student = await createStudent();
      const lesson = await createLesson();
      return prisma.entitlement.create({
        data: { studentId: student.id, lessonId: lesson.id, reason: "ADMIN_GRANT", grantedById: "ghost" },
      });
    }],
    ["User.blockedById", async () => {
      const student = await createStudent();
      return prisma.user.update({ where: { id: student.userId }, data: { status: "BLOCKED", blockedById: "ghost" } });
    }],
  ])("rejects a fabricated %s", async (_label, write) => {
    await expect(write()).rejects.toThrow();
  });

  it("refuses to delete an admin named as the granter of an entitlement (audit trail kept)", async () => {
    const admin = await createTeacher();
    const student = await createStudent();
    const lesson = await createLesson();
    await prisma.entitlement.create({
      data: { studentId: student.id, lessonId: lesson.id, reason: "ADMIN_GRANT", grantedById: admin.id },
    });
    await expect(prisma.user.delete({ where: { id: admin.id } })).rejects.toThrow();
  });
});

describe("ReferralReward types", () => {
  async function pair() {
    const referrer = await createStudent();
    const referred = await createStudent();
    return { referrer, referred };
  }

  it("stores the reward as a whole number of days of a known type", async () => {
    const { referrer, referred } = await pair();
    await setPlatformSetting(PLATFORM_SETTING_KEYS.REFERRAL_REWARD_DAYS, 10);
    const reward = await createPendingReferralReward(prisma, {
      referralCode: referrer.referralCode,
      referredStudentId: referred.id,
    });
    expect(reward?.rewardType).toBe("SUBSCRIPTION_EXTENSION_DAYS");
    expect(reward?.rewardValue).toBe(10);
  });

  it("refuses a fractional reward setting instead of rounding it", async () => {
    const { referrer, referred } = await pair();
    await setPlatformSetting(PLATFORM_SETTING_KEYS.REFERRAL_REWARD_DAYS, 2.5);
    await expect(
      createPendingReferralReward(prisma, { referralCode: referrer.referralCode, referredStudentId: referred.id }),
    ).rejects.toThrow("whole number");
    expect(await prisma.referralReward.count()).toBe(0);
  });

  it("the database rejects unknown reward types, even through raw SQL", async () => {
    const { referrer, referred } = await pair();
    await expect(
      prisma.referralReward.create({
        data: {
          referrerStudentId: referrer.id,
          referredStudentId: referred.id,
          rewardType: "FREE_MONEY" as never,
          rewardValue: 1,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ReferralReward" (id, "referrerStudentId", "referredStudentId", "rewardType", "rewardValue")
         VALUES ('r1', $1, $2, 'FREE_MONEY', 1)`,
        referrer.id,
        referred.id,
      ),
    ).rejects.toThrow();
  });

  it("stores rewardValue in an integer column (fractions are refused by the app, see above)", async () => {
    const [column] = await prisma.$queryRaw<Array<{ data_type: string }>>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'ReferralReward' AND column_name = 'rewardValue'`;
    expect(column.data_type).toBe("integer");
  });
});
