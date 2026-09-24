import type { ContentStatus, Prisma, PrismaClient } from "@prisma/client";

/**
 * What a student can do with a piece of content, derived from the statuses
 * of the whole chain it lives in (video → lesson → course):
 *
 * - HIDDEN (any link is DRAFT, i.e. unpublished): invisible and
 *   inaccessible to every student, including ones who already paid.
 *   Entitlement rows are left untouched, so access comes back as soon as the
 *   teacher re-publishes.
 * - ARCHIVED (retired content): removed from every listing, from search and
 *   from every NEW grant, and no longer free for everyone — but a student
 *   who already holds a live entitlement keeps access to what they paid for.
 * - PUBLISHED: normal rules.
 */
export type ContentState = "PUBLISHED" | "ARCHIVED" | "HIDDEN";

export function effectiveContentState(
  ...statuses: (ContentStatus | null | undefined)[]
): ContentState {
  const present = statuses.filter((s): s is ContentStatus => Boolean(s));
  if (present.includes("DRAFT")) return "HIDDEN";
  if (present.includes("ARCHIVED")) return "ARCHIVED";
  return "PUBLISHED";
}

/** Prisma filter for "this lesson is visible in student-facing listings". */
export const PUBLISHED_LESSON_WHERE = {
  status: "PUBLISHED",
  course: { status: "PUBLISHED" },
} satisfies Prisma.LessonWhereInput;

/** An entitlement that currently grants access (not revoked, not expired). */
export function liveEntitlementWhere(now: Date): Prisma.EntitlementWhereInput {
  return {
    revokedAt: null,
    OR: [
      // Subscription-backed grant: valid while the subscription itself is active and unexpired.
      { subscriptionId: { not: null }, subscription: { status: "ACTIVE", expiresAt: { gt: now } } },
      // Standalone grant (PROMO/FREE/ADMIN_GRANT) with no expiry — permanent.
      { subscriptionId: null, expiresAt: null },
      // Standalone grant with a time-boxed expiry (e.g. a FREE_PERIOD promo).
      { subscriptionId: null, expiresAt: { gt: now } },
    ],
  };
}

export type LessonAvailability =
  | { allowed: true; state: "PUBLISHED" | "ARCHIVED"; via: "FREE" | "ENTITLED" }
  | { allowed: false; reason: "LESSON_NOT_FOUND" | "CONTENT_UNAVAILABLE" | "NOT_ENTITLED" };

/**
 * Whether a student may use a lesson's non-video content (quiz, experiments,
 * attachments). A free lesson is open to everyone only while it is
 * published; otherwise a live entitlement to the lesson (or its video) is
 * required. Unpublished content is refused to everyone.
 */
export async function checkLessonAvailability(
  prisma: PrismaClient,
  params: { studentId: string; lessonId: string },
): Promise<LessonAvailability> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: params.lessonId },
    include: { course: true, video: true },
  });
  if (!lesson) return { allowed: false, reason: "LESSON_NOT_FOUND" };

  const state = effectiveContentState(lesson.status, lesson.course.status);
  if (state === "HIDDEN") return { allowed: false, reason: "CONTENT_UNAVAILABLE" };

  if (lesson.isFree && state === "PUBLISHED") {
    return { allowed: true, state, via: "FREE" };
  }

  const entitlement = await prisma.entitlement.findFirst({
    where: {
      studentId: params.studentId,
      AND: [
        liveEntitlementWhere(new Date()),
        {
          OR: [
            { lessonId: lesson.id },
            ...(lesson.video ? [{ videoId: lesson.video.id }] : []),
          ],
        },
      ],
    },
  });
  if (!entitlement) return { allowed: false, reason: "NOT_ENTITLED" };
  return { allowed: true, state, via: "ENTITLED" };
}

/**
 * The single server-side gate for anything a student does inside a lesson
 * besides watching its video: the lesson must be available to them
 * (published/entitled) AND its prerequisite chain must be satisfied. Every
 * server action / route for lesson quizzes, experiments and attachments
 * calls this — a page-level check alone is never the security boundary.
 */
export async function assertStudentCanUseLesson(
  prisma: PrismaClient,
  params: { studentId: string; lessonId: string },
) {
  const availability = await checkLessonAvailability(prisma, params);
  if (!availability.allowed) {
    throw new Error(
      availability.reason === "NOT_ENTITLED"
        ? "لا تملك صلاحية الوصول إلى هذا الدرس"
        : "هذا الدرس غير متاح",
    );
  }
  const sequence = await canAccessLesson(prisma, params);
  if (!sequence.allowed) {
    throw new Error("يجب إكمال الدرس السابق واجتياز اختباره أولًا");
  }
  return availability;
}

export type LessonAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "PREVIOUS_LESSON_NOT_COMPLETED" };

export async function canAccessLesson(
  prisma: PrismaClient,
  params: { studentId: string; lessonId: string },
): Promise<LessonAccessDecision> {
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: params.lessonId },
  });

  // `isFree` only means "no paid entitlement required" (see checkVideoAccess's
  // FREE_VIDEO rule) — it must NOT also bypass the sequential-unlock
  // requirement. A free lesson with a requiredPreviousLessonId still has to
  // wait for that prerequisite, same as a paid one (real bug found in the
  // final audit: this used to short-circuit on isFree alone).
  if (!lesson.requiredPreviousLessonId) {
    return { allowed: true };
  }

  const previousProgress = await prisma.lessonProgress.findUnique({
    where: {
      studentId_lessonId: {
        studentId: params.studentId,
        lessonId: lesson.requiredPreviousLessonId,
      },
    },
  });

  if (previousProgress?.status === "COMPLETED" && previousProgress.quizPassed) {
    return { allowed: true };
  }

  return { allowed: false, reason: "PREVIOUS_LESSON_NOT_COMPLETED" };
}
