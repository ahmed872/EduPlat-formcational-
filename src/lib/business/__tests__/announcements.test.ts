import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCourse, createLesson, createStudent, createVideo } from "@/test/factories";
import {
  getAnnouncementsForParent,
  getAnnouncementsForStudent,
  publishAnnouncement,
  resolveAnnouncementStudentIds,
} from "@/lib/business/announcements";

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

async function entitle(studentId: string, lessonId: string) {
  return prisma.entitlement.create({ data: { studentId, lessonId, reason: "FREE" } });
}

describe("resolveAnnouncementStudentIds", () => {
  it("ALL resolves to every real student", async () => {
    const a = await createStudent();
    const b = await createStudent();

    const ids = await resolveAnnouncementStudentIds(prisma, { audienceType: "ALL", audienceRefId: null });

    expect(new Set(ids)).toEqual(new Set([a.id, b.id]));
  });

  it("STUDENT resolves to exactly the named student", async () => {
    const a = await createStudent();
    await createStudent();

    const ids = await resolveAnnouncementStudentIds(prisma, {
      audienceType: "STUDENT",
      audienceRefId: a.id,
    });

    expect(ids).toEqual([a.id]);
  });

  it("COURSE resolves to only students really enrolled (Entitlement or WatchSession)", async () => {
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const enrolled = await createStudent();
    await entitle(enrolled.id, lesson.id);
    await createStudent(); // unrelated student, never enrolled

    const ids = await resolveAnnouncementStudentIds(prisma, {
      audienceType: "COURSE",
      audienceRefId: course.id,
    });

    expect(ids).toEqual([enrolled.id]);
  });

  it("COURSE also counts a free-lesson watcher with no Entitlement row", async () => {
    const course = await createCourse();
    const freeLesson = await createLesson({ courseId: course.id, isFree: true });
    const video = await createVideo({ lessonId: freeLesson.id, isFree: true });
    const watcher = await createStudent();
    await prisma.watchSession.create({
      data: { studentId: watcher.id, videoId: video.id, watchedSeconds: 30 },
    });

    const ids = await resolveAnnouncementStudentIds(prisma, {
      audienceType: "COURSE",
      audienceRefId: course.id,
    });

    expect(ids).toEqual([watcher.id]);
  });

  it("CATEGORY resolves to enrolled students across every course in that category", async () => {
    const courseA = await createCourse();
    const category = await prisma.category.findUniqueOrThrow({ where: { id: courseA.categoryId } });
    const courseB = await createCourse({ categoryId: category.id });
    const lessonA = await createLesson({ courseId: courseA.id });
    const lessonB = await createLesson({ courseId: courseB.id });
    const studentA = await createStudent();
    const studentB = await createStudent();
    await entitle(studentA.id, lessonA.id);
    await entitle(studentB.id, lessonB.id);

    const ids = await resolveAnnouncementStudentIds(prisma, {
      audienceType: "CATEGORY",
      audienceRefId: category.id,
    });

    expect(new Set(ids)).toEqual(new Set([studentA.id, studentB.id]));
  });

  it("rejects the unsupported GROUP audience honestly instead of returning zero silently", async () => {
    await expect(
      resolveAnnouncementStudentIds(prisma, { audienceType: "GROUP", audienceRefId: "whatever" }),
    ).rejects.toThrow(/غير مدعوم/);
  });
});

describe("publishAnnouncement", () => {
  it("creates a real Notification for every resolved recipient", async () => {
    const teacher = await createTeacherUser();
    const student = await createStudent();
    const studentUser = await prisma.user.findUniqueOrThrow({
      where: { id: (await prisma.studentProfile.findUniqueOrThrow({ where: { id: student.id } })).userId },
    });

    const { notifiedCount } = await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "إعلان هام",
      body: "نص الإعلان",
      audienceType: "ALL",
      audienceRefId: null,
    });

    expect(notifiedCount).toBe(1);
    const notification = await prisma.notification.findFirst({
      where: { userId: studentUser.id, type: "ANNOUNCEMENT" },
    });
    expect(notification?.title).toBe("إعلان هام");
  });

  it("rejects a CATEGORY/COURSE/STUDENT announcement with no target specified", async () => {
    const teacher = await createTeacherUser();

    await expect(
      publishAnnouncement(prisma, {
        teacherId: teacher.id,
        title: "س",
        body: "و",
        audienceType: "STUDENT",
        audienceRefId: null,
      }),
    ).rejects.toThrow(/يتطلب تحديد الجمهور/);
  });
});

describe("getAnnouncementsForStudent", () => {
  it("shows ALL-audience and own-STUDENT-audience announcements, hides other students'", async () => {
    const teacher = await createTeacherUser();
    const me = await createStudent();
    const someoneElse = await createStudent();

    await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "للجميع",
      body: "و",
      audienceType: "ALL",
      audienceRefId: null,
    });
    await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "لي فقط",
      body: "و",
      audienceType: "STUDENT",
      audienceRefId: me.id,
    });
    await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "لشخص آخر",
      body: "و",
      audienceType: "STUDENT",
      audienceRefId: someoneElse.id,
    });

    const mine = await getAnnouncementsForStudent(prisma, me.id);

    expect(mine.map((a) => a.title).sort()).toEqual(["للجميع", "لي فقط"].sort());
  });

  it("shows a COURSE announcement only to students really enrolled in that course", async () => {
    const teacher = await createTeacherUser();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const enrolled = await createStudent();
    const notEnrolled = await createStudent();
    await entitle(enrolled.id, lesson.id);

    await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "إعلان كورس",
      body: "و",
      audienceType: "COURSE",
      audienceRefId: course.id,
    });

    expect((await getAnnouncementsForStudent(prisma, enrolled.id)).map((a) => a.title)).toContain(
      "إعلان كورس",
    );
    expect((await getAnnouncementsForStudent(prisma, notEnrolled.id)).map((a) => a.title)).not.toContain(
      "إعلان كورس",
    );
  });
});

describe("getAnnouncementsForParent", () => {
  it("shows ALL-audience announcements and STUDENT announcements for an approved child only", async () => {
    const teacher = await createTeacherUser();
    const parentUser = await prisma.user.create({
      data: {
        email: `parent-${Date.now()}@test.local`,
        name: "Test Parent",
        passwordHash: "x",
        role: "PARENT",
      },
    });
    const parentProfile = await prisma.parentProfile.create({ data: { userId: parentUser.id } });
    const approvedChild = await createStudent();
    const unrelatedChild = await createStudent();
    await prisma.parentStudent.create({
      data: { parentId: parentProfile.id, studentId: approvedChild.id, approvedAt: new Date() },
    });

    await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "للجميع",
      body: "و",
      audienceType: "ALL",
      audienceRefId: null,
    });
    await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "لابني",
      body: "و",
      audienceType: "STUDENT",
      audienceRefId: approvedChild.id,
    });
    await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "لطالب آخر",
      body: "و",
      audienceType: "STUDENT",
      audienceRefId: unrelatedChild.id,
    });

    const visible = await getAnnouncementsForParent(prisma, parentProfile.id);

    expect(visible.map((a) => a.title).sort()).toEqual(["لابني", "للجميع"].sort());
  });

  it("never shows a STUDENT announcement for a not-yet-approved link", async () => {
    const teacher = await createTeacherUser();
    const parentUser = await prisma.user.create({
      data: {
        email: `parent2-${Date.now()}@test.local`,
        name: "Test Parent",
        passwordHash: "x",
        role: "PARENT",
      },
    });
    const parentProfile = await prisma.parentProfile.create({ data: { userId: parentUser.id } });
    const pendingChild = await createStudent();
    await prisma.parentStudent.create({
      data: { parentId: parentProfile.id, studentId: pendingChild.id, approvedAt: null },
    });

    await publishAnnouncement(prisma, {
      teacherId: teacher.id,
      title: "لابني المعلّق",
      body: "و",
      audienceType: "STUDENT",
      audienceRefId: pendingChild.id,
    });

    const visible = await getAnnouncementsForParent(prisma, parentProfile.id);
    expect(visible.map((a) => a.title)).not.toContain("لابني المعلّق");
  });
});
