import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import {
  createCourse,
  createEntitlement,
  createLesson,
  createStudent,
  createTeacher,
  createVideo,
} from "@/test/factories";
import { createQuestion, createQuiz } from "@/test/factories-quiz";
import { sessionCookieFor } from "@/test/session";
import { confirmPayment, refundPayment, rejectPayment, startSubscriptionCheckout } from "@/lib/business/subscription";
import { issueSignedPlaybackUrl } from "@/lib/business/playback";
import { checkVideoAccess } from "@/lib/business/video-access";
import { assertHeartbeatTargetIsReal } from "@/lib/business/study-time";
import { checkLessonAvailability } from "@/lib/business/content-visibility";
import { startQuizAttempt, submitQuizAttempt } from "@/lib/business/quiz";
import { getVideoStorageProvider } from "@/lib/storage/provider";
import { PLATFORM_SETTING_KEYS, setPlatformSetting } from "@/lib/platform-settings";
import { GET as streamGET } from "@/app/api/stream/[videoId]/route";

beforeEach(async () => {
  await resetDatabase();
});

async function paidPlan() {
  const course = await createCourse();
  const lesson = await createLesson({ courseId: course.id });
  const video = await createVideo({ lessonId: lesson.id });
  const plan = await prisma.subscriptionPlan.create({
    data: { name: "خطة", priceCents: 10000, academicYear: "2026" },
  });
  await prisma.subscriptionPlanItem.create({ data: { planId: plan.id, courseId: course.id } });
  return { course, lesson, video, plan };
}

describe("checkout integrity", () => {
  it("regression: refuses to sell a subscription when the configured academic year has already ended", async () => {
    await setPlatformSetting(PLATFORM_SETTING_KEYS.ACADEMIC_YEAR_END, "2020-07-31");
    const student = await createStudent();
    const { plan } = await paidPlan();
    await expect(startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id })).rejects.toThrow(
      "العام الدراسي",
    );
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("regression: a replayed checkout can't open a second subscription for the same plan", async () => {
    const student = await createStudent();
    const { plan } = await paidPlan();
    await startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id });
    await expect(startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id })).rejects.toThrow();
    expect(await prisma.subscription.count({ where: { studentId: student.id } })).toBe(1);
  });

  it("regression: concurrent checkouts of the same plan create exactly one subscription and one payment", async () => {
    const student = await createStudent();
    const { plan } = await paidPlan();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.subscription.count({ where: { studentId: student.id } })).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
  });

  it("allows buying the same plan again once the previous subscription ended", async () => {
    const student = await createStudent();
    const { plan } = await paidPlan();
    const { subscription } = await startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id });
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "CANCELLED" } });
    await expect(startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id })).resolves.toBeTruthy();
  });

  it("concurrent confirmations of one payment grant entitlements once", async () => {
    const student = await createStudent();
    const teacher = await createTeacher();
    const { plan } = await paidPlan();
    const { payment } = await startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.entitlement.count({ where: { studentId: student.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "CONFIRM_PAYMENT" } })).toBe(1);
  });
});

describe("manual payment decisions are atomic", () => {
  async function pendingPayment() {
    const student = await createStudent();
    const teacher = await createTeacher();
    const { plan } = await paidPlan();
    const { payment, subscription } = await startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id });
    return { student, teacher, payment, subscription };
  }

  it("regression: a confirm racing a reject ends in one consistent outcome, never FAILED-with-access", async () => {
    for (let round = 0; round < 5; round++) {
      await resetDatabase();
      const { student, teacher, payment, subscription } = await pendingPayment();
      const outcomes = await Promise.allSettled([
        confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id }),
        rejectPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id, reason: "لم يصل المبلغ" }),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);

      const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const finalSub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      const activeEntitlements = await prisma.entitlement.count({ where: { studentId: student.id, revokedAt: null } });
      if (finalPayment.status === "SUCCEEDED") {
        expect(finalSub.status).toBe("ACTIVE");
        expect(activeEntitlements).toBeGreaterThan(0);
      } else {
        expect(finalPayment.status).toBe("FAILED");
        expect(finalSub.status).toBe("CANCELLED");
        expect(activeEntitlements).toBe(0);
      }
      const decisions = await prisma.auditLog.count({ where: { entityId: payment.id } });
      expect(decisions).toBe(1);
    }
  });

  it("regression: two simultaneous refunds are recorded once", async () => {
    const { teacher, payment } = await pendingPayment();
    await confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id });
    const outcomes = await Promise.allSettled([
      refundPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id, reason: "a" }),
      refundPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id, reason: "b" }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: payment.id, action: "REFUND_PAYMENT" } })).toBe(1);
  });

  it("never grants access before a teacher confirms, and a rejected payment can't be confirmed later", async () => {
    const { student, teacher, payment, subscription } = await pendingPayment();
    expect(subscription.status).toBe("PENDING_PAYMENT");
    expect(payment.status).toBe("PENDING");
    expect(payment.provider).toBe("MANUAL_OFFLINE");
    expect(await prisma.entitlement.count({ where: { studentId: student.id } })).toBe(0);

    await rejectPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id, reason: "x" });
    await expect(confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id })).rejects.toThrow();
    expect(await prisma.entitlement.count({ where: { studentId: student.id } })).toBe(0);
  });
});

describe("expiry and revocation reach every surface", () => {
  it("an expired subscription loses video, experiments/attachments/quizzes (lesson availability) and an outstanding stream URL", async () => {
    const student = await createStudent();
    const teacher = await createTeacher();
    const { plan, video, lesson } = await paidPlan();
    await getVideoStorageProvider().save(video.storageKey, Buffer.alloc(1000, 1));
    const { subscription, payment } = await startSubscriptionCheckout(prisma, { studentId: student.id, planId: plan.id });
    await confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id });
    const issued = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id });
    if ("error" in issued) throw new Error(issued.error);

    await prisma.subscription.update({ where: { id: subscription.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await checkLessonAvailability(prisma, { studentId: student.id, lessonId: lesson.id })).allowed).toBe(false);
    expect("error" in (await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id }))).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
    const cookie = await sessionCookieFor({ id: user.id, role: user.role, studentProfileId: student.id });
    const res = await streamGET(new NextRequest(`http://localhost${issued.url}`, { headers: { cookie } }), {
      params: Promise.resolve({ videoId: video.id }),
    });
    expect(res!.status).toBe(403);
  });

  it("revoking an admin grant cuts an outstanding stream URL on the next request", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    await getVideoStorageProvider().save(video.storageKey, Buffer.alloc(1000, 1));
    const issued = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id });
    if ("error" in issued) throw new Error(issued.error);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
    const cookie = await sessionCookieFor({ id: user.id, role: user.role, studentProfileId: student.id });
    const get = () =>
      streamGET(new NextRequest(`http://localhost${issued.url}`, { headers: { cookie, range: "bytes=0-9" } }), {
        params: Promise.resolve({ videoId: video.id }),
      });
    expect((await get())!.status).toBe(206);
    await prisma.entitlement.updateMany({ where: { studentId: student.id }, data: { revokedAt: new Date() } });
    expect((await get())!.status).toBe(403);
  });
});

describe("exam deadline cannot be bypassed", () => {
  async function timedQuiz() {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    const question = await createQuestion({ type: "SINGLE_CHOICE", correctAnswer: "2", options: ["1", "2"] } as never);
    const quiz = await createQuiz({ lessonId: lesson.id, questionIds: [question.id] });
    await prisma.quiz.update({ where: { id: quiz.id }, data: { timeLimitMinutes: 10 } });
    const attempt = await startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id });
    return { attempt, question };
  }

  it("regression: a correct answer submitted after the time limit (+grace) scores zero", async () => {
    const { attempt, question } = await timedQuiz();
    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: { startedAt: new Date(Date.now() - (10 * 60 + 25) * 1000) },
    });
    const graded = await submitQuizAttempt(prisma, {
      attemptId: attempt.id,
      answers: [{ questionId: question.id, studentAnswer: "2" }],
    });
    expect(graded?.passed).toBe(false);
    const answer = await prisma.quizAnswer.findFirstOrThrow({ where: { attemptId: attempt.id } });
    expect(answer.pointsAwarded).toBe(0);
  });

  it("a correct answer inside the limit is graded normally", async () => {
    const { attempt, question } = await timedQuiz();
    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: { startedAt: new Date(Date.now() - 9 * 60 * 1000) },
    });
    const graded = await submitQuizAttempt(prisma, {
      attemptId: attempt.id,
      answers: [{ questionId: question.id, studentAnswer: "2" }],
    });
    expect(graded?.passed).toBe(true);
  });

  it("concurrent double submission records one set of answers", async () => {
    const { attempt, question } = await timedQuiz();
    await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        submitQuizAttempt(prisma, { attemptId: attempt.id, answers: [{ questionId: question.id, studentAnswer: "2" }] }),
      ),
    );
    expect(await prisma.quizAnswer.count({ where: { attemptId: attempt.id } })).toBe(1);
    const final = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(final.status).toBe("GRADED");
  });
});

describe("sequential unlock can't be bypassed through the video APIs", () => {
  async function gatedPair() {
    const course = await createCourse();
    const lessonA = await createLesson({ courseId: course.id });
    const lessonB = await createLesson({ courseId: course.id, requiredPreviousLessonId: lessonA.id });
    const videoA = await createVideo({ lessonId: lessonA.id });
    const videoB = await createVideo({ lessonId: lessonB.id });
    const student = await createStudent();
    await createEntitlement({ studentId: student.id, lessonId: lessonA.id });
    await createEntitlement({ studentId: student.id, lessonId: lessonB.id });
    return { student, lessonA, lessonB, videoA, videoB };
  }

  it("regression: an entitled student can't get lesson B's playback URL before completing lesson A", async () => {
    const { student, lessonA, videoA, videoB } = await gatedPair();
    expect("url" in (await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: videoA.id }))).toBe(true);
    const locked = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: videoB.id });
    expect("url" in locked).toBe(false);

    // Completing lesson A (with its quiz passed) unlocks lesson B.
    await prisma.lessonProgress.create({
      data: { studentId: student.id, lessonId: lessonA.id, status: "COMPLETED", quizPassed: true },
    });
    expect("url" in (await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: videoB.id }))).toBe(true);
  });

  it("regression: a locked lesson's video earns no study time and accepts no notes", async () => {
    const { student, videoB } = await gatedPair();
    await expect(
      assertHeartbeatTargetIsReal(prisma, { studentId: student.id, type: "VIDEO", refId: videoB.id }),
    ).rejects.toThrow();
    const decision = await checkVideoAccess(prisma, { studentId: student.id, videoId: videoB.id });
    expect(decision).toMatchObject({ allowed: false, reason: "LESSON_LOCKED" });
  });
});
