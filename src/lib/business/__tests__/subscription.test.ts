import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCourse, createLesson, createStudent, createVideo } from "@/test/factories";
import { checkVideoAccess } from "@/lib/business/video-access";
import {
  computeAcademicYearExpiry,
  confirmPayment,
  redeemFreeContentPromo,
  refundPayment,
  rejectPayment,
  startSubscriptionCheckout,
  syncExpiredSubscriptions,
} from "@/lib/business/subscription";
import { createPendingReferralReward } from "@/lib/business/referral";
import { PLATFORM_SETTING_KEYS, setPlatformSetting } from "@/lib/platform-settings";

beforeEach(async () => {
  await resetDatabase();
});

async function setupPaidCourse(priceCents = 10000) {
  const course = await createCourse();
  const lesson = await createLesson({ courseId: course.id });
  const video = await createVideo({ lessonId: lesson.id });
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: "خطة سبتمبر",
      priceCents,
      academicYear: "2026",
    },
  });
  await prisma.subscriptionPlanItem.create({
    data: { planId: plan.id, courseId: course.id },
  });
  return { course, lesson, video, plan };
}

describe("subscription checkout & payment states", () => {
  it("a non-zero plan starts PENDING_PAYMENT and grants no access until confirmed", async () => {
    const student = await createStudent();
    const { plan, video } = await setupPaidCourse();

    const { subscription, payment } = await startSubscriptionCheckout(prisma, {
      studentId: student.id,
      planId: plan.id,
    });

    expect(subscription.status).toBe("PENDING_PAYMENT");
    expect(payment.status).toBe("PENDING");
    expect(payment.amountCents).toBe(10000);

    const before = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(before.allowed).toBe(false);
    expect(before.reason).toBe("NOT_ENTITLED");

    const teacher = await prisma.user.create({
      data: {
        email: "teacher-confirm@test.local",
        name: "Teacher",
        passwordHash: "x",
        role: "TEACHER_ADMIN",
      },
    });
    await confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id });

    const after = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(after.allowed).toBe(true);

    const updatedSubscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(updatedSubscription.status).toBe("ACTIVE");
  });

  it("rejecting a pending payment cancels the subscription and grants nothing", async () => {
    const student = await createStudent();
    const { plan, video } = await setupPaidCourse();
    const { payment } = await startSubscriptionCheckout(prisma, {
      studentId: student.id,
      planId: plan.id,
    });

    const teacher = await prisma.user.create({
      data: {
        email: "teacher-reject@test.local",
        name: "Teacher",
        passwordHash: "x",
        role: "TEACHER_ADMIN",
      },
    });
    await rejectPayment(prisma, {
      paymentId: payment.id,
      adminUserId: teacher.id,
      reason: "لم يتم استلام التحويل",
    });

    const decision = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(decision.allowed).toBe(false);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updatedPayment.status).toBe("FAILED");
  });

  it("cannot confirm a payment twice", async () => {
    const student = await createStudent();
    const { plan } = await setupPaidCourse();
    const { payment } = await startSubscriptionCheckout(prisma, {
      studentId: student.id,
      planId: plan.id,
    });
    const teacher = await prisma.user.create({
      data: { email: "t2@test.local", name: "T", passwordHash: "x", role: "TEACHER_ADMIN" },
    });
    await confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id });

    await expect(
      confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id }),
    ).rejects.toThrow(/Cannot confirm/);
  });

  it("never double-confirms the same payment under concurrent confirm calls", async () => {
    // Regression test for a real race: a plain read-then-write status check
    // (even inside a $transaction) let two concurrent confirmPayment calls
    // for the same payment both pass, both grant entitlements again, and
    // both fire a second SUBSCRIPTION_ACTIVATED notification.
    const student = await createStudent();
    const { plan } = await setupPaidCourse();
    const { payment } = await startSubscriptionCheckout(prisma, {
      studentId: student.id,
      planId: plan.id,
    });
    const teacher = await prisma.user.create({
      data: { email: "race-confirm@test.local", name: "T", passwordHash: "x", role: "TEACHER_ADMIN" },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id }),
      ),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded).toHaveLength(1);

    const notifications = await prisma.notification.findMany({
      where: { userId: student.userId, type: "SUBSCRIPTION_ACTIVATED" },
    });
    expect(notifications).toHaveLength(1);
  });

  it("a zero-amount checkout (free plan / 100%-off promo) never grants a referral reward", async () => {
    // Regression test for a real bug: startSubscriptionCheckout's
    // zero-amount success branch used to call applyPendingReferralReward
    // unconditionally — but referral.ts's own stated intent is to reward a
    // genuine signup-to-PAYING-customer conversion, not a $0 checkout with
    // nothing actually collected. That let anyone farm referral rewards by
    // registering with a code and immediately redeeming a 100%-off promo.
    const referrer = await createStudent();
    const referred = await createStudent();
    await setPlatformSetting(PLATFORM_SETTING_KEYS.REFERRAL_REWARD_DAYS, 10);
    await createPendingReferralReward(prisma, {
      referralCode: referrer.referralCode,
      referredStudentId: referred.id,
    });

    const { plan } = await setupPaidCourse();
    await prisma.promoCode.create({ data: { code: "FREEFORFARMING", type: "FREE_100" } });

    await startSubscriptionCheckout(prisma, {
      studentId: referred.id,
      planId: plan.id,
      promoCode: "FREEFORFARMING",
    });

    const reward = await prisma.referralReward.findUniqueOrThrow({
      where: { referredStudentId: referred.id },
    });
    expect(reward.appliedAt).toBeNull(); // still pending — never applied
  });

  it("a 100%-off promo code makes the subscription active immediately with no payment step", async () => {
    const student = await createStudent();
    const { plan, video } = await setupPaidCourse();
    await prisma.promoCode.create({
      data: { code: "FREE100", type: "FREE_100" },
    });

    const { subscription, payment } = await startSubscriptionCheckout(prisma, {
      studentId: student.id,
      planId: plan.id,
      promoCode: "FREE100",
    });

    expect(payment.amountCents).toBe(0);
    expect(payment.status).toBe("SUCCEEDED");
    expect(subscription.status).toBe("ACTIVE");

    const decision = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(decision.allowed).toBe(true);

    const notifications = await prisma.notification.findMany({
      where: { userId: student.userId, type: "SUBSCRIPTION_ACTIVATED" },
    });
    expect(notifications).toHaveLength(1);
  });

  it("a percentage discount reduces the charge but still requires manual confirmation", async () => {
    const student = await createStudent();
    const { plan } = await setupPaidCourse(20000);
    await prisma.promoCode.create({
      data: { code: "SAVE25", type: "PERCENT_DISCOUNT", value: 25 },
    });

    const { payment } = await startSubscriptionCheckout(prisma, {
      studentId: student.id,
      planId: plan.id,
      promoCode: "SAVE25",
    });

    expect(payment.originalAmountCents).toBe(20000);
    expect(payment.amountCents).toBe(15000);
    expect(payment.status).toBe("PENDING");
  });

  it("rejects an expired or invalid promo code at checkout", async () => {
    const student = await createStudent();
    const { plan } = await setupPaidCourse();
    await prisma.promoCode.create({
      data: {
        code: "OLDCODE",
        type: "PERCENT_DISCOUNT",
        value: 10,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expect(
      startSubscriptionCheckout(prisma, {
        studentId: student.id,
        planId: plan.id,
        promoCode: "OLDCODE",
      }),
    ).rejects.toThrow(/invalid/i);
  });

  it("refunding a succeeded payment revokes access", async () => {
    const student = await createStudent();
    const { plan, video } = await setupPaidCourse();
    const { payment } = await startSubscriptionCheckout(prisma, {
      studentId: student.id,
      planId: plan.id,
    });
    const teacher = await prisma.user.create({
      data: { email: "t3@test.local", name: "T", passwordHash: "x", role: "TEACHER_ADMIN" },
    });
    await confirmPayment(prisma, { paymentId: payment.id, adminUserId: teacher.id });
    expect(
      (await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id })).allowed,
    ).toBe(true);

    await refundPayment(prisma, {
      paymentId: payment.id,
      adminUserId: teacher.id,
      reason: "طلب استرداد",
    });

    const decision = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(decision.allowed).toBe(false);
  });
});

describe("free-content promo codes (no subscription involved)", () => {
  it("FREE_LESSON promo grants direct entitlement to the linked course's lessons", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id });

    const promo = await prisma.promoCode.create({
      data: { code: "FREELESSON1", type: "FREE_LESSON" },
    });
    await prisma.promoApplicableContent.create({
      data: { promoId: promo.id, courseId: course.id },
    });

    const before = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(before.allowed).toBe(false);

    const { grantedCount } = await redeemFreeContentPromo(prisma, {
      code: "FREELESSON1",
      studentId: student.id,
    });
    expect(grantedCount).toBe(1);

    const after = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(after.allowed).toBe(true);
  });

  it("FREE_PERIOD promo grants access that expires at the academic year end", async () => {
    await setPlatformSetting(PLATFORM_SETTING_KEYS.ACADEMIC_YEAR_END, "2020-01-01");
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id });
    const promo = await prisma.promoCode.create({
      data: { code: "FREEPERIOD1", type: "FREE_PERIOD" },
    });
    await prisma.promoApplicableContent.create({
      data: { promoId: promo.id, courseId: course.id },
    });

    await redeemFreeContentPromo(prisma, { code: "FREEPERIOD1", studentId: student.id });

    // The configured academic year end (2020) is already in the past.
    const decision = await checkVideoAccess(prisma, { studentId: student.id, videoId: video.id });
    expect(decision.allowed).toBe(false);
  });

  it("rejects a discount-type promo code from the free-content redemption path", async () => {
    const student = await createStudent();
    await prisma.promoCode.create({
      data: { code: "DISCOUNTONLY", type: "PERCENT_DISCOUNT", value: 10 },
    });

    await expect(
      redeemFreeContentPromo(prisma, { code: "DISCOUNTONLY", studentId: student.id }),
    ).rejects.toThrow(/does not grant content directly/);
  });
});

describe("academic-year expiry", () => {
  it("computeAcademicYearExpiry reads the configured platform setting", async () => {
    await setPlatformSetting(PLATFORM_SETTING_KEYS.ACADEMIC_YEAR_END, "2027-07-31");
    const expiry = await computeAcademicYearExpiry();
    expect(expiry.toISOString().slice(0, 10)).toBe("2027-07-31");
  });

  it("syncExpiredSubscriptions flips ACTIVE-but-past-expiry subscriptions to EXPIRED", async () => {
    const student = await createStudent();
    const { plan } = await setupPaidCourse();
    const subscription = await prisma.subscription.create({
      data: {
        studentId: student.id,
        planId: plan.id,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const count = await syncExpiredSubscriptions(prisma);
    expect(count).toBeGreaterThanOrEqual(1);

    const updated = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(updated.status).toBe("EXPIRED");
  });
});
