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
 *
 * The view-limit gate (checkVideoAccess) only runs when a NEW session is
 * opened — it must also be re-checked HERE, at the point a view is actually
 * consumed, inside one transaction. Otherwise a student can open several
 * WatchSessions back-to-back (each one starts before any of them has
 * consumed a view, so the limit check at creation time never trips) and
 * then flip each one's consumedView independently, exceeding video.viewLimit
 * via ordinary API calls with no race required.
 */
export async function updateWatchProgress(
  prisma: PrismaClient,
  params: {
    sessionId: string;
    watchedSeconds: number;
    videoDurationSeconds: number;
  },
) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.watchSession.findUnique({
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

    const crossesThreshold =
      !session.consumedView && !session.video.isFree && completionPercent >= threshold;

    let shouldConsume = false;
    let viewNumber: number | null = session.viewNumber;
    if (crossesThreshold) {
      // Re-count consumed views for THIS video, right now, inside the same
      // transaction — a stale count read before several sessions were
      // opened is exactly what let the limit be bypassed.
      const consumedCount = await tx.watchSession.count({
        where: {
          studentId: session.studentId,
          videoId: session.videoId,
          consumedView: true,
          id: { not: session.id },
        },
      });
      if (consumedCount < session.video.viewLimit) {
        shouldConsume = true;
        viewNumber = consumedCount + 1;
      }
      // else: the limit was already reached by other sessions (opened
      // concurrently or previously) — this session's progress is still
      // recorded below, but it never gets to consume a view it has no
      // budget left for.
    }

    return tx.watchSession.update({
      where: { id: session.id },
      data: {
        watchedSeconds: params.watchedSeconds,
        completionPercent,
        consumedView: shouldConsume || session.consumedView,
        viewNumber,
      },
    });
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
 * Batch form of grantAdminEntitlement: grants one lesson to every student
 * with a currently ACTIVE, unexpired subscription whose plan includes the
 * lesson's whole course (a SubscriptionPlanItem with that courseId). Plans
 * that only include hand-picked individual lessons are deliberately not
 * treated as "subscribed to the course", so this can never over-grant paid
 * content to them.
 *
 * - Idempotent: a student who already holds a live entitlement to the lesson
 *   is skipped, so running it twice never duplicates rows.
 * - Each grant expires with the subscription that qualified the student
 *   (unless an explicit, earlier expiresAt is given), so a bonus lesson never
 *   outlives the paid access it was a bonus to.
 * - Still explicit and human-authorized (ADMIN_GRANT + grantedById), and the
 *   whole batch is written in one transaction with an AuditLog row.
 */
export async function grantLessonToCourseSubscribers(
  prisma: PrismaClient,
  params: { lessonId: string; grantedById: string; expiresAt?: Date; now?: Date },
): Promise<{ granted: number; skipped: number }> {
  const now = params.now ?? new Date();
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: params.lessonId },
    include: { video: true },
  });

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      cancelledAt: null,
      expiresAt: { gt: now },
      plan: { items: { some: { courseId: lesson.courseId } } },
    },
    orderBy: { expiresAt: "desc" },
  });

  // One grant per student, tied to their longest-running qualifying subscription.
  const expiryByStudent = new Map<string, Date>();
  for (const subscription of subscriptions) {
    if (!expiryByStudent.has(subscription.studentId)) {
      expiryByStudent.set(subscription.studentId, subscription.expiresAt);
    }
  }

  const alreadyEntitled = await prisma.entitlement.findMany({
    where: {
      lessonId: lesson.id,
      studentId: { in: Array.from(expiryByStudent.keys()) },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { studentId: true },
  });
  const skip = new Set(alreadyEntitled.map((e) => e.studentId));
  const toGrant = Array.from(expiryByStudent.entries()).filter(([studentId]) => !skip.has(studentId));

  await prisma.$transaction([
    ...toGrant.map(([studentId, subscriptionExpiry]) =>
      prisma.entitlement.create({
        data: {
          studentId,
          lessonId: lesson.id,
          videoId: lesson.video?.id,
          reason: "ADMIN_GRANT",
          grantedById: params.grantedById,
          expiresAt:
            params.expiresAt && params.expiresAt < subscriptionExpiry
              ? params.expiresAt
              : subscriptionExpiry,
        },
      }),
    ),
    prisma.auditLog.create({
      data: {
        actorId: params.grantedById,
        action: "BATCH_GRANT_LESSON",
        entityType: "Lesson",
        entityId: lesson.id,
        metadata: { courseId: lesson.courseId, granted: toGrant.length, skipped: skip.size },
      },
    }),
  ]);

  return { granted: toGrant.length, skipped: skip.size };
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
