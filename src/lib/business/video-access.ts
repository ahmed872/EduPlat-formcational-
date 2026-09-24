import type { PrismaClient } from "@prisma/client";
import {
  PUBLISHED_LESSON_WHERE,
  effectiveContentState,
  liveEntitlementWhere,
} from "@/lib/business/content-visibility";
import {
  PLATFORM_SETTING_KEYS,
  getPlatformSetting,
} from "@/lib/platform-settings";

/**
 * New grants only ever cover content that is published at grant time: a
 * lesson/course that is still a draft (so "published later") or archived
 * is never snapshotted into a new entitlement, and neither is a video that
 * is not itself published.
 */
function grantableVideoId(video: { id: string; status: string } | null | undefined) {
  return video && video.status === "PUBLISHED" ? video.id : undefined;
}

async function assertLessonGrantable(prisma: PrismaClient, lessonId: string) {
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: { video: true, course: true },
  });
  if (effectiveContentState(lesson.status, lesson.course.status) !== "PUBLISHED") {
    throw new Error("لا يمكن منح وصول لدرس غير منشور أو مؤرشف");
  }
  return lesson;
}

export type VideoAccessDecision =
  | { allowed: true; reason: "FREE_VIDEO" | "ENTITLED"; viewsUsed: number; viewLimit: number | null }
  | {
      allowed: false;
      reason: "VIDEO_NOT_FOUND" | "CONTENT_UNAVAILABLE" | "NOT_ENTITLED" | "VIEW_LIMIT_REACHED";
      viewsUsed: number;
      viewLimit: number | null;
    };

/**
 * The single gate every playback/signed-URL endpoint must call. It never
 * infers access from "student has an active subscription" alone — it
 * requires an explicit, auditable Entitlement row for this exact video (or
 * its lesson), which is how newly published content never leaks into an
 * older purchase (see grantEntitlementsForSubscription).
 *
 * Publication state is enforced here too (see content-visibility.ts): an
 * unpublished video/lesson/course is refused to everyone, and an archived
 * one is no longer free for everyone — only existing entitlement holders
 * keep access.
 */
export async function checkVideoAccess(
  prisma: PrismaClient,
  params: { studentId: string; videoId: string },
): Promise<VideoAccessDecision> {
  const video = await prisma.video.findUnique({
    where: { id: params.videoId },
    include: { lesson: { include: { course: true } } },
  });
  if (!video) {
    return {
      allowed: false,
      reason: "VIDEO_NOT_FOUND",
      viewsUsed: 0,
      viewLimit: null,
    };
  }

  const state = effectiveContentState(
    video.status,
    video.lesson?.status,
    video.lesson?.course.status,
  );
  if (state === "HIDDEN") {
    return {
      allowed: false,
      reason: "CONTENT_UNAVAILABLE",
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

  if (video.isFree && state === "PUBLISHED") {
    return { allowed: true, reason: "FREE_VIDEO", viewsUsed, viewLimit: null };
  }

  const now = new Date();
  const entitlement = await prisma.entitlement.findFirst({
    where: {
      studentId: params.studentId,
      videoId: params.videoId,
      ...liveEntitlementWhere(now),
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

    // The server's own duration wins when the teacher recorded one — a
    // client could otherwise report a huge duration so its progress never
    // reaches the threshold.
    const duration =
      session.video.durationSeconds && session.video.durationSeconds > 0
        ? session.video.durationSeconds
        : params.videoDurationSeconds;
    const watchedSeconds = duration > 0 ? Math.min(params.watchedSeconds, duration) : params.watchedSeconds;
    const completionPercent = duration > 0 ? Math.min(100, (watchedSeconds / duration) * 100) : 0;

    const threshold = await getPlatformSetting<number>(
      PLATFORM_SETTING_KEYS.VIEW_CONSUMPTION_THRESHOLD_PERCENT,
    );
    const consumed =
      completionPercent >= threshold ? await consumeViewIfWithinLimit(tx, session) : null;

    return tx.watchSession.update({
      where: { id: session.id },
      data: {
        watchedSeconds,
        completionPercent,
        ...(consumed ? { consumedView: true, viewNumber: consumed.viewNumber } : {}),
      },
    });
  });
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Marks a session as a consumed view if the student still has budget for
 * this video. Serialized per (student, video) with a transaction-scoped
 * advisory lock: without it, two sessions crossing the threshold at the
 * same moment could both count "2 used of 3" and both consume, exceeding
 * the limit. Returns the assigned view number, or null when nothing was
 * consumed (free video, already consumed, or no budget left).
 */
async function consumeViewIfWithinLimit(
  tx: Tx,
  session: { id: string; studentId: string; videoId: string; consumedView: boolean; video: { isFree: boolean; viewLimit: number } },
): Promise<{ viewNumber: number } | null> {
  if (session.consumedView || session.video.isFree) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`view:${session.studentId}:${session.videoId}`}))`;
  // Re-read under the lock: another request may have consumed this very
  // session, or other sessions, a moment ago.
  const fresh = await tx.watchSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { consumedView: true },
  });
  if (fresh.consumedView) return null;
  const consumedCount = await tx.watchSession.count({
    where: {
      studentId: session.studentId,
      videoId: session.videoId,
      consumedView: true,
      id: { not: session.id },
    },
  });
  if (consumedCount >= session.video.viewLimit) return null;
  const viewNumber = consumedCount + 1;
  await tx.watchSession.update({
    where: { id: session.id },
    data: { consumedView: true, viewNumber },
  });
  return { viewNumber };
}

/** The file is tracked in 100 slices; a slice counts once fully delivered. */
const COVERAGE_BUCKETS = 100;

export function deliveredBuckets(params: { fileSize: number; start: number; bytes: number }): number[] {
  const { fileSize, start, bytes } = params;
  if (fileSize <= 0 || bytes <= 0) return [];
  const end = Math.min(fileSize, start + bytes); // exclusive
  const buckets: number[] = [];
  for (let i = 0; i < COVERAGE_BUCKETS; i++) {
    const bucketStart = Math.floor((i * fileSize) / COVERAGE_BUCKETS);
    const bucketEnd = Math.floor(((i + 1) * fileSize) / COVERAGE_BUCKETS);
    if (bucketStart >= start && bucketEnd <= end && (bucketEnd > bucketStart || bucketStart < end)) {
      buckets.push(i);
    }
  }
  return buckets;
}

/**
 * Server-side view accounting, called by the stream route after it has
 * sent a byte range for a playback session. The delivered slices are
 * merged atomically into the session; once the session has received at
 * least the configured threshold of the file, a view is consumed exactly
 * as if the player had reported that much progress. This is what makes
 * the view limit hold for a client that never reports progress (or
 * reports false progress): what counts is what the server delivered.
 */
export async function recordDeliveredRange(
  prisma: PrismaClient,
  params: { sessionId: string; fileSize: number; start: number; bytes: number },
): Promise<{ coveragePercent: number; consumedView: boolean }> {
  const buckets = deliveredBuckets(params);
  const rows = await prisma.$queryRaw<Array<{ coverage: number }>>`
    UPDATE "WatchSession"
    SET "servedBuckets" = ARRAY(
      SELECT DISTINCT b FROM unnest("servedBuckets" || ${buckets}::int[]) AS b ORDER BY b
    )
    WHERE id = ${params.sessionId}
    RETURNING cardinality("servedBuckets") AS coverage`;
  if (rows.length === 0) throw new Error("Watch session not found");
  const coveragePercent = (Number(rows[0].coverage) / COVERAGE_BUCKETS) * 100;

  const threshold = await getPlatformSetting<number>(
    PLATFORM_SETTING_KEYS.VIEW_CONSUMPTION_THRESHOLD_PERCENT,
  );
  if (coveragePercent < threshold) {
    const current = await prisma.watchSession.findUniqueOrThrow({
      where: { id: params.sessionId },
      select: { consumedView: true },
    });
    return { coveragePercent, consumedView: current.consumedView };
  }
  return prisma.$transaction(async (tx) => {
    const session = await tx.watchSession.findUniqueOrThrow({
      where: { id: params.sessionId },
      include: { video: true },
    });
    const consumed = await consumeViewIfWithinLimit(tx, session);
    return { coveragePercent, consumedView: session.consumedView || consumed !== null };
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
    where: { id: { in: Array.from(lessonIds) }, ...PUBLISHED_LESSON_WHERE },
    include: { video: true },
  });

  await prisma.$transaction(
    lessons.map((lesson) =>
      prisma.entitlement.create({
        data: {
          studentId: subscription.studentId,
          subscriptionId: subscription.id,
          lessonId: lesson.id,
          videoId: grantableVideoId(lesson.video),
          reason: "SUBSCRIPTION",
        },
      }),
    ),
  );

  return lessons.length;
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
  const lesson = await assertLessonGrantable(prisma, params.lessonId);

  return prisma.entitlement.create({
    data: {
      studentId: params.studentId,
      lessonId: lesson.id,
      videoId: grantableVideoId(lesson.video),
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
  const lesson = await assertLessonGrantable(prisma, params.lessonId);

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
          videoId: grantableVideoId(lesson.video),
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
    where: { id: { in: Array.from(lessonIds) }, ...PUBLISHED_LESSON_WHERE },
    include: { video: true },
  });

  await prisma.$transaction(
    lessons.map((lesson) =>
      prisma.entitlement.create({
        data: {
          studentId: params.studentId,
          promoRedemptionId: params.redemptionId,
          lessonId: lesson.id,
          videoId: grantableVideoId(lesson.video),
          reason: "PROMO",
          expiresAt: params.expiresAt,
        },
      }),
    ),
  );

  return lessons.length;
}
