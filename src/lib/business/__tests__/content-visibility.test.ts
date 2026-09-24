import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import {
  createCourse,
  createEntitlement,
  createLesson,
  createStudent,
  createSubscriptionPlan,
  createVideo,
} from "@/test/factories";
import { createQuestion, createQuiz } from "@/test/factories-quiz";
import { setContentStatus } from "@/lib/business/content-status";
import {
  checkLessonAvailability,
  effectiveContentState,
} from "@/lib/business/content-visibility";
import {
  checkVideoAccess,
  grantAdminEntitlement,
  grantEntitlementsForSubscription,
  grantLessonToCourseSubscribers,
} from "@/lib/business/video-access";
import { startQuizAttempt } from "@/lib/business/quiz";
import { searchForStudent } from "@/lib/business/search";

beforeEach(async () => {
  await resetDatabase();
});

async function createTeacher() {
  return prisma.user.create({
    data: {
      email: `t-${Date.now()}-${Math.random()}@test.local`,
      name: "T",
      passwordHash: "x",
      role: "TEACHER_ADMIN",
    },
  });
}

async function subscribe(studentId: string, courseId: string) {
  const plan = await createSubscriptionPlan();
  await prisma.subscriptionPlanItem.create({ data: { planId: plan.id, courseId } });
  const subscription = await prisma.subscription.create({
    data: {
      studentId,
      planId: plan.id,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 86_400_000 * 30),
    },
  });
  await grantEntitlementsForSubscription(prisma, subscription.id);
  return subscription;
}

describe("effectiveContentState", () => {
  it("is HIDDEN if any link is DRAFT, ARCHIVED if any is archived, else PUBLISHED", () => {
    expect(effectiveContentState("PUBLISHED", "DRAFT", "ARCHIVED")).toBe("HIDDEN");
    expect(effectiveContentState("PUBLISHED", "ARCHIVED", "PUBLISHED")).toBe("ARCHIVED");
    expect(effectiveContentState("PUBLISHED", null, "PUBLISHED")).toBe("PUBLISHED");
  });
});

describe("setContentStatus authorization", () => {
  it("rejects students and parents, even when called directly", async () => {
    const lesson = await createLesson();
    for (const role of ["STUDENT", "PARENT"] as const) {
      await expect(
        setContentStatus(prisma, { actorRole: role, kind: "LESSON", id: lesson.id, status: "DRAFT" }),
      ).rejects.toThrow(/غير مصرح/);
    }
    expect((await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).status).toBe("PUBLISHED");
  });

  it("lets a teacher publish, unpublish and archive a course, lesson and video", async () => {
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id });
    for (const status of ["DRAFT", "ARCHIVED", "PUBLISHED"] as const) {
      await setContentStatus(prisma, { actorRole: "TEACHER_ADMIN", kind: "COURSE", id: course.id, status });
      await setContentStatus(prisma, { actorRole: "TEACHER_ADMIN", kind: "LESSON", id: lesson.id, status });
      await setContentStatus(prisma, { actorRole: "TEACHER_ADMIN", kind: "VIDEO", id: video.id, status });
      expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).status).toBe(status);
      expect((await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).status).toBe(status);
      expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).status).toBe(status);
    }
  });

  it("rejects an unknown status value", async () => {
    const lesson = await createLesson();
    await expect(
      setContentStatus(prisma, {
        actorRole: "TEACHER_ADMIN",
        kind: "LESSON",
        id: lesson.id,
        status: "DELETED" as never,
      }),
    ).rejects.toThrow();
  });
});

describe("unpublished (DRAFT) content is refused to everyone", () => {
  it("a free video in an unpublished lesson is no longer reachable by direct id", async () => {
    // Regression: checkVideoAccess used to ignore status entirely, so a
    // draft lesson's free video played for anyone who knew its id.
    const student = await createStudent();
    const lesson = await createLesson({ isFree: true, status: "DRAFT" });
    const video = await createVideo({ lessonId: lesson.id, isFree: true });

    const decision = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(decision).toMatchObject({ allowed: false, reason: "CONTENT_UNAVAILABLE" });
  });

  it("applies to an unpublished course and to an unpublished video too", async () => {
    const student = await createStudent();
    const draftCourse = await createCourse({ status: "DRAFT" });
    const lessonInDraftCourse = await createLesson({ courseId: draftCourse.id, isFree: true });
    const videoA = await createVideo({ lessonId: lessonInDraftCourse.id, isFree: true });
    const lesson = await createLesson({ isFree: true });
    const videoB = await createVideo({ lessonId: lesson.id, isFree: true });
    await prisma.video.update({ where: { id: videoB.id }, data: { status: "DRAFT" } });

    for (const videoId of [videoA.id, videoB.id]) {
      const decision = await checkVideoAccess(prisma, { studentId: student.id, videoId });
      expect(decision).toMatchObject({ allowed: false, reason: "CONTENT_UNAVAILABLE" });
    }
  });

  it("blocks even a paying student while unpublished, and restores access on re-publish without touching the entitlement", async () => {
    const teacher = await createTeacher();
    const student = await createStudent();
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });
    const entitlement = await createEntitlement({ studentId: student.id, lessonId: lesson.id });

    await setContentStatus(prisma, { actorRole: teacher.role, kind: "LESSON", id: lesson.id, status: "DRAFT" });
    expect(await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id })).toMatchObject({
      allowed: false,
      reason: "CONTENT_UNAVAILABLE",
    });
    expect(await checkLessonAvailability(prisma, { studentId: student.id, lessonId: lesson.id })).toEqual({
      allowed: false,
      reason: "CONTENT_UNAVAILABLE",
    });

    await setContentStatus(prisma, { actorRole: teacher.role, kind: "LESSON", id: lesson.id, status: "PUBLISHED" });
    expect((await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id })).allowed).toBe(true);

    const after = await prisma.entitlement.findUniqueOrThrow({ where: { id: entitlement.id } });
    expect(after).toEqual(entitlement);
  });

  it("refuses to start an unpublished lesson's quiz even for an entitled student (direct API)", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ status: "DRAFT" });
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    const quiz = await createQuiz({ lessonId: lesson.id, questionIds: [(await createQuestion()).id] });

    await expect(startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id })).rejects.toThrow(
      /not available/,
    );
  });

  it("excludes unpublished and archived lessons from student search", async () => {
    const course = await createCourse();
    await prisma.lesson.create({ data: { courseId: course.id, title: "بحث-منشور", status: "PUBLISHED" } });
    await prisma.lesson.create({ data: { courseId: course.id, title: "بحث-مسودة", status: "DRAFT" } });
    await prisma.lesson.create({ data: { courseId: course.id, title: "بحث-مؤرشف", status: "ARCHIVED" } });

    const results = await searchForStudent(prisma, "بحث-");
    const titles = results.map((r) => r.title);
    expect(titles).toContain("بحث-منشور");
    expect(titles).not.toContain("بحث-مسودة");
    expect(titles).not.toContain("بحث-مؤرشف");
  });
});

describe("paid lesson quizzes require an entitlement (direct API)", () => {
  it("refuses a paid lesson's quiz without an entitlement, allows it with one", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const quiz = await createQuiz({ lessonId: lesson.id, questionIds: [(await createQuestion()).id] });

    await expect(startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id })).rejects.toThrow(
      /do not have access/,
    );

    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    await expect(startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id })).resolves.toBeTruthy();
  });
});

describe("ARCHIVED content", () => {
  it("keeps access for students who already hold an entitlement", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: "ARCHIVED" } });

    expect((await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id })).allowed).toBe(true);
    expect(await checkLessonAvailability(prisma, { studentId: student.id, lessonId: lesson.id })).toEqual({
      allowed: true,
      state: "ARCHIVED",
      via: "ENTITLED",
    });
  });

  it("is no longer free for everyone", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ isFree: true, status: "ARCHIVED" });
    const video = await createVideo({ lessonId: lesson.id, isFree: true });

    expect(await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id })).toMatchObject({
      allowed: false,
      reason: "NOT_ENTITLED",
    });
    expect(await checkLessonAvailability(prisma, { studentId: student.id, lessonId: lesson.id })).toEqual({
      allowed: false,
      reason: "NOT_ENTITLED",
    });
  });
});

describe("new entitlements only cover content published at grant time", () => {
  it("a subscription snapshots only published lessons — a draft published later is NOT granted", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const published = await createLesson({ courseId: course.id });
    const publishedVideo = await createVideo({ lessonId: published.id });
    const draft = await createLesson({ courseId: course.id, status: "DRAFT" });
    const draftVideo = await createVideo({ lessonId: draft.id });
    const archived = await createLesson({ courseId: course.id, status: "ARCHIVED" });
    await createVideo({ lessonId: archived.id });

    await subscribe(student.id, course.id);

    const granted = await prisma.entitlement.findMany({ where: { studentId: student.id } });
    expect(granted.map((e) => e.lessonId)).toEqual([published.id]);

    // Regression: drafts used to be snapshotted too, so publishing one after
    // the purchase silently handed it to every earlier subscriber.
    await prisma.lesson.update({ where: { id: draft.id }, data: { status: "PUBLISHED" } });
    expect((await checkVideoAccess(prisma, { studentId: student.id, videoId: draftVideo.id })).allowed).toBe(
      false,
    );
    expect((await checkVideoAccess(prisma, { studentId: student.id, videoId: publishedVideo.id })).allowed).toBe(
      true,
    );
  });

  it("does not attach an unpublished video to a new grant", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id });
    await prisma.video.update({ where: { id: video.id }, data: { status: "DRAFT" } });

    await subscribe(student.id, course.id);
    const [grant] = await prisma.entitlement.findMany({ where: { studentId: student.id } });
    expect(grant.lessonId).toBe(lesson.id);
    expect(grant.videoId).toBeNull();
  });

  it("refuses admin and batch grants of archived or unpublished lessons", async () => {
    const teacher = await createTeacher();
    const student = await createStudent();
    for (const status of ["ARCHIVED", "DRAFT"] as const) {
      const lesson = await createLesson({ status });
      await expect(
        grantAdminEntitlement(prisma, { studentId: student.id, lessonId: lesson.id, grantedById: teacher.id }),
      ).rejects.toThrow(/غير منشور أو مؤرشف/);
      await expect(
        grantLessonToCourseSubscribers(prisma, { lessonId: lesson.id, grantedById: teacher.id }),
      ).rejects.toThrow(/غير منشور أو مؤرشف/);
    }
    expect(await prisma.entitlement.count()).toBe(0);
  });

  it("archiving never deletes or alters existing entitlements", async () => {
    const teacher = await createTeacher();
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    await createVideo({ lessonId: lesson.id });
    await subscribe(student.id, course.id);
    const before = await prisma.entitlement.findMany({ orderBy: { id: "asc" } });

    await setContentStatus(prisma, { actorRole: teacher.role, kind: "COURSE", id: course.id, status: "ARCHIVED" });
    await setContentStatus(prisma, { actorRole: teacher.role, kind: "LESSON", id: lesson.id, status: "ARCHIVED" });

    expect(await prisma.entitlement.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
});
