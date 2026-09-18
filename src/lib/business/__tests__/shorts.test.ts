import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCourse, createLesson, createStudent, createVideo } from "@/test/factories";
import { grantEntitlementsForSubscription } from "@/lib/business/video-access";
import { resolveShortCallToAction } from "@/lib/business/shorts";

beforeEach(async () => {
  await resetDatabase();
});

async function createShort(overrides: {
  sourceVideoId?: string;
  sourceTimestampSeconds?: number;
} = {}) {
  return prisma.short.create({
    data: {
      title: "شرح سريع",
      storageKey: `short-${Date.now()}-${Math.random()}`,
      durationSeconds: 60,
      sourceVideoId: overrides.sourceVideoId,
      sourceTimestampSeconds: overrides.sourceTimestampSeconds,
      status: "PUBLISHED",
    },
  });
}

describe("resolveShortCallToAction", () => {
  it("returns NO_SOURCE when the short has no linked video/timestamp", async () => {
    const short = await createShort();
    const result = await resolveShortCallToAction(prisma, {
      shortId: short.id,
      studentId: null,
    });
    expect(result).toEqual({ type: "NO_SOURCE" });
  });

  it("shows a subscribe CTA to a guest even when the short has a source video", async () => {
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });
    const short = await createShort({
      sourceVideoId: video.id,
      sourceTimestampSeconds: 872,
    });

    const result = await resolveShortCallToAction(prisma, {
      shortId: short.id,
      studentId: null,
    });
    expect(result).toEqual({ type: "SUBSCRIBE_CTA", reason: "GUEST" });
  });

  it("shows a subscribe CTA to a logged-in student without entitlement", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });
    const short = await createShort({
      sourceVideoId: video.id,
      sourceTimestampSeconds: 872,
    });

    const result = await resolveShortCallToAction(prisma, {
      shortId: short.id,
      studentId: student.id,
    });
    expect(result).toEqual({ type: "SUBSCRIBE_CTA", reason: "NOT_ENTITLED" });
  });

  it("opens the original video at the linked timestamp for an entitled student", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id });
    const short = await createShort({
      sourceVideoId: video.id,
      sourceTimestampSeconds: 872,
    });

    const plan = await prisma.subscriptionPlan.create({
      data: { name: "plan", priceCents: 0, academicYear: "2026" },
    });
    await prisma.subscriptionPlanItem.create({
      data: { planId: plan.id, courseId: course.id },
    });
    const subscription = await prisma.subscription.create({
      data: {
        studentId: student.id,
        planId: plan.id,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 1_000_000),
      },
    });
    await grantEntitlementsForSubscription(prisma, subscription.id);

    const result = await resolveShortCallToAction(prisma, {
      shortId: short.id,
      studentId: student.id,
    });
    expect(result).toEqual({
      type: "OPEN_ORIGINAL",
      videoId: video.id,
      timestampSeconds: 872,
    });
  });

  it("a free video's short opens directly even without any subscription", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ isFree: true });
    const video = await createVideo({ lessonId: lesson.id, isFree: true });
    const short = await createShort({
      sourceVideoId: video.id,
      sourceTimestampSeconds: 30,
    });

    const result = await resolveShortCallToAction(prisma, {
      shortId: short.id,
      studentId: student.id,
    });
    expect(result).toEqual({
      type: "OPEN_ORIGINAL",
      videoId: video.id,
      timestampSeconds: 30,
    });
  });
});
