import type { PrismaClient } from "@prisma/client";
import {
  PLATFORM_SETTING_KEYS,
  getPlatformSetting,
} from "@/lib/platform-settings";

export type VideoAccessDecision =
  | { allowed: true; reason: "FREE_VIDEO" | "ENTITLED"; viewsUsed: number; viewLimit: number | null }
  | {
      allowed: false;
      reason: "VIDEO_NOT_FOUND" | "NOT_ENTITLED" | "VIEW_LIMIT_REACHED";
      viewsUsed: number;
      viewLimit: number | null;
    };

/**
 * The single gate every playback/signed-URL endpoint must call. It never
 * infers access from "student has an active subscription" alone — it
 * requires an explicit, auditable Entitlement row for this exact video (or
 * its lesson), which is how newly published content never leaks into an
 * older purchase (see grantEntitlementsForSubscription).
 */
export async function checkVideoAccess(
  prisma: PrismaClient,
  params: { studentId: string; videoId: string },
): Promise<VideoAccessDecision> {
  const video = await prisma.video.findUnique({
    where: { id: params.videoId },
  });
  if (!video) {
    return {
      allowed: false,
      reason: "VIDEO_NOT_FOUND",
      viewsUsed: 0,
      viewLimit: null,
    };
  }

  const viewsUsed = await prisma.watchSession.count({
    where: {
      studentId: params.studentId,
      videoId: params.videoId,
      consumedView: true,
    },
  });

  if (video.isFree) {
    return { allowed: true, reason: "FREE_VIDEO", viewsUsed, viewLimit: null };
  }

  const now = new Date();
  const entitlement = await prisma.entitlement.findFirst({
    where: {
      studentId: params.studentId,
      videoId: params.videoId,
      revokedAt: null,
      OR: [
        // Subscription-backed grant: valid while the subscription itself is active and unexpired.
        { subscriptionId: { not: null }, subscription: { status: "ACTIVE", expiresAt: { gt: now } } },
        // Standalone grant (PROMO/FREE/ADMIN_GRANT) with no expiry — permanent.
        { subscriptionId: null, expiresAt: null },
        // Standalone grant with a time-boxed expiry (e.g. a FREE_PERIOD promo).
        { subscriptionId: null, expiresAt: { gt: now } },
      ],
    },
  });

  if (!entitlement) {
    return {
      allowed: false,
      reason: "NOT_ENTITLED",
      viewsUsed,
      viewLimit: video.viewLimit,
    };
  }

  if (viewsUsed >= video.viewLimit) {
    return {
      allowed: false,
      reason: "VIEW_LIMIT_REACHED",
      viewsUsed,
      viewLimit: video.viewLimit,
    };
  }

  return {
    allowed: true,
    reason: "ENTITLED",
    viewsUsed,
    viewLimit: video.viewLimit,
  };
}

export async function startWatchSession(
  prisma: PrismaClient,
  params: { studentId: string; videoId: string },
) {
  const decision = await checkVideoAccess(prisma, params);
  if (!decision.allowed) {
    throw new Error(`Video access denied: ${decision.reason}`);
  }
  return prisma.watchSession.create({
    data: {
      studentId: params.studentId,
      videoId: params.videoId,
    },
  });
}

/**
 * Updates a session's watched progress and, once the configured completion
 * threshold is crossed for the first time, marks it as a consumed view with
 * its ordinal view number. Merely opening the page never consumes a view —
 * only meaningful playback does.
 */
export async function updateWatchProgress(
  prisma: PrismaClient,
  params: {
    sessionId: string;
    watchedSeconds: number;
    videoDurationSeconds: number;
  },
) {
  const session = await prisma.watchSession.findUnique({
    where: { id: params.sessionId },
    include: { video: true },
  });
  if (!session) throw new Error("Watch session not found");

  const completionPercent =
    params.videoDurationSeconds > 0
      ? Math.min(100, (params.watchedSeconds / params.videoDurationSeconds) * 100)
      : 0;

  const threshold = await getPlatformSetting<number>(
    PLATFORM_SETTING_KEYS.VIEW_CONSUMPTION_THRESHOLD_PERCENT,
  );

  const shouldConsume =
    !session.consumedView && !session.video.isFree && completionPercent >= threshold;

  let viewNumber: number | null = session.viewNumber;
  if (shouldConsume) {
    const priorConsumed = await prisma.watchSession.count({
      where: {
        studentId: session.studentId,
        videoId: session.videoId,
        consumedView: true,
        id: { not: session.id },
      },
    });
    viewNumber = priorConsumed + 1;
  }

  return prisma.watchSession.update({
    where: { id: session.id },
    data: {
      watchedSeconds: params.watchedSeconds,
      completionPercent,
      consumedView: shouldConsume || session.consumedView,
      viewNumber,
    },
  });
}

/**
 * Snapshots the plan's content into explicit per-video/lesson Entitlement
 * rows at the moment the subscription is created. Lessons/videos added to
 * the course AFTER this call are intentionally excluded — the teacher (or a
 * future re-subscription/renewal) must grant them explicitly.
 */
export async function grantEntitlementsForSubscription(
  prisma: PrismaClient,
  subscriptionId: string,
) {
  const subscription = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    include: { plan: { include: { items: true } } },
  });

  const lessonIds = new Set<string>();
  for (const item of subscription.plan.items) {
    if (item.lessonId) lessonIds.add(item.lessonId);
    if (item.courseId) {
      const lessons = await prisma.lesson.findMany({
        where: { courseId: item.courseId },
        select: { id: true },
      });
      lessons.forEach((lesson) => lessonIds.add(lesson.id));
    }
  }

  const lessons = await prisma.lesson.findMany({
    where: { id: { in: Array.from(lessonIds) } },
    include: { video: true },
  });

  await prisma.$transaction(
    lessons.map((lesson) =>
      prisma.entitlement.create({
        data: {
          studentId: subscription.studentId,
          subscriptionId: subscription.id,
          lessonId: lesson.id,
          videoId: lesson.video?.id,
          reason: "SUBSCRIPTION",
        },
      }),
    ),
  );

  return lessonIds.size;
}

/**
 * A single, explicit, human-authorized grant for one lesson — the escape
 * hatch when content published after a student's subscription window needs
 * to reach them without a whole new subscription (e.g. a teacher manually
 * unlocking a bonus lesson). Every grant records who did it and why.
 */
export async function grantAdminEntitlement(
  prisma: PrismaClient,
  params: {
    studentId: string;
    lessonId: string;
    grantedById: string;
    expiresAt?: Date;
  },
) {
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: params.lessonId },
    include: { video: true },
  });

  return prisma.entitlement.create({
    data: {
      studentId: params.studentId,
      lessonId: lesson.id,
      videoId: lesson.video?.id,
      reason: "ADMIN_GRANT",
      grantedById: params.grantedById,
      expiresAt: params.expiresAt,
    },
  });
}

/**
 * Grants entitlements sourced from a promo redemption's linked content
 * (PromoApplicableContent), bypassing subscriptions/payments entirely —
 * this is how FREE_LESSON / FREE_PACKAGE / FREE_PERIOD promo codes actually
 * hand out access. `expiresAt` is left unset (permanent) unless the caller
 * passes one (used for FREE_PERIOD, bounded to the academic year).
 */
export async function grantEntitlementsForPromoRedemption(
  prisma: PrismaClient,
  params: { promoId: string; redemptionId: string; studentId: string; expiresAt?: Date },
) {
  const applicable = await prisma.promoApplicableContent.findMany({
    where: { promoId: params.promoId },
  });

  const lessonIds = new Set<string>();
  for (const item of applicable) {
    if (item.lessonId) lessonIds.add(item.lessonId);
    if (item.courseId) {
      const lessons = await prisma.lesson.findMany({
        where: { courseId: item.courseId },
        select: { id: true },
      });
      lessons.forEach((lesson) => lessonIds.add(lesson.id));
    }
  }

  const lessons = await prisma.lesson.findMany({
    where: { id: { in: Array.from(lessonIds) } },
    include: { video: true },
  });

  await prisma.$transaction(
    lessons.map((lesson) =>
      prisma.entitlement.create({
        data: {
          studentId: params.studentId,
          promoRedemptionId: params.redemptionId,
          lessonId: lesson.id,
          videoId: lesson.video?.id,
          reason: "PROMO",
          expiresAt: params.expiresAt,
        },
      }),
    ),
  );

  return lessonIds.size;
}
