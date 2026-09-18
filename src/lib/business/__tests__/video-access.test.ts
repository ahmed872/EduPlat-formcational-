import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import {
  createCourse,
  createLesson,
  createStudent,
  createSubscriptionPlan,
  createVideo,
} from "@/test/factories";
import {
  checkVideoAccess,
  grantEntitlementsForSubscription,
  startWatchSession,
  updateWatchProgress,
} from "@/lib/business/video-access";

beforeEach(async () => {
  await resetDatabase();
});

async function subscribeStudentToCourse(studentId: string, courseId: string) {
  const plan = await createSubscriptionPlan();
  await prisma.subscriptionPlanItem.create({
    data: { planId: plan.id, courseId },
  });
  const subscription = await prisma.subscription.create({
    data: {
      studentId,
      planId: plan.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    },
  });
  await grantEntitlementsForSubscription(prisma, subscription.id);
  return subscription;
}

describe("checkVideoAccess", () => {
  it("denies an unauthorized (non-entitled) student", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });

    const decision = await checkVideoAccess(prisma, {
      studentId: student.id,
      videoId: video.id,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("NOT_ENTITLED");
  });

  it("allows an authorized (entitled) student to watch", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id });
    await subscribeStudentToCourse(student.id, course.id);

    const decision = await checkVideoAccess(prisma, {
      studentId: student.id,
      videoId: video.id,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ENTITLED");
  });

  it("allows a free video without any subscription", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ isFree: true });
    const video = await createVideo({ lessonId: lesson.id, isFree: true });

    const decision = await checkVideoAccess(prisma, {
      studentId: student.id,
      videoId: video.id,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("FREE_VIDEO");
  });

  it("allows the 3rd view and blocks the 4th (default view limit)", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id, viewLimit: 3 });
    await subscribeStudentToCourse(student.id, course.id);

    for (let i = 1; i <= 3; i++) {
      const decision = await checkVideoAccess(prisma, {
        studentId: student.id,
        videoId: video.id,
      });
      expect(decision.allowed, `view ${i} should be allowed`).toBe(true);

      const session = await startWatchSession(prisma, {
        studentId: student.id,
        videoId: video.id,
      });
      await updateWatchProgress(prisma, {
        sessionId: session.id,
        watchedSeconds: 600,
        videoDurationSeconds: 600,
      });
    }

    const fourth = await checkVideoAccess(prisma, {
      studentId: student.id,
      videoId: video.id,
    });
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe("VIEW_LIMIT_REACHED");
    expect(fourth.viewsUsed).toBe(3);

    await expect(
      startWatchSession(prisma, { studentId: student.id, videoId: video.id }),
    ).rejects.toThrow();
  });

  it("does not consume a view for a session that never crosses the threshold", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id, viewLimit: 3 });
    await subscribeStudentToCourse(student.id, course.id);

    const session = await startWatchSession(prisma, {
      studentId: student.id,
      videoId: video.id,
    });
    // Opened the page but only watched 5% — merely opening must not count.
    await updateWatchProgress(prisma, {
      sessionId: session.id,
      watchedSeconds: 30,
      videoDurationSeconds: 600,
    });

    const decision = await checkVideoAccess(prisma, {
      studentId: student.id,
      videoId: video.id,
    });
    expect(decision.viewsUsed).toBe(0);
    expect(decision.allowed).toBe(true);
  });

  it("does not leak newly published content into an existing entitlement", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lessonSeptember = await createLesson({ courseId: course.id });
    const videoSeptember = await createVideo({ lessonId: lessonSeptember.id });
    await subscribeStudentToCourse(student.id, course.id);

    // A new lesson/video is published to the SAME course after purchase.
    const lessonOctober = await createLesson({ courseId: course.id });
    const videoOctober = await createVideo({ lessonId: lessonOctober.id });

    const septemberDecision = await checkVideoAccess(prisma, {
      studentId: student.id,
      videoId: videoSeptember.id,
    });
    const octoberDecision = await checkVideoAccess(prisma, {
      studentId: student.id,
      videoId: videoOctober.id,
    });

    expect(septemberDecision.allowed).toBe(true);
    expect(octoberDecision.allowed).toBe(false);
    expect(octoberDecision.reason).toBe("NOT_ENTITLED");
  });

  it("denies access once the subscription has expired", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id });

    const plan = await createSubscriptionPlan();
    await prisma.subscriptionPlanItem.create({
      data: { planId: plan.id, courseId: course.id },
    });
    const subscription = await prisma.subscription.create({
      data: {
        studentId: student.id,
        planId: plan.id,
        expiresAt: new Date(Date.now() - 1000 * 60), // already expired
        status: "EXPIRED",
      },
    });
    await grantEntitlementsForSubscription(prisma, subscription.id);

    const decision = await checkVideoAccess(prisma, {
      studentId: student.id,
      videoId: video.id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("NOT_ENTITLED");
  });
});
