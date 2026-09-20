import type { PrismaClient } from "@prisma/client";
import { notify } from "@/lib/business/notifications";
import { isUniqueConstraintError } from "@/lib/prisma-errors";

export const ACHIEVEMENT_METRICS = [
  "STREAK_DAYS",
  "LESSONS_COMPLETED",
  "QUIZZES_PASSED",
  "EXPERIMENTS_COMPLETED",
  "GAME_POINTS",
] as const;
export type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];

export type AchievementCriteria = { metric: AchievementMetric; threshold: number };

function asCriteria(value: unknown): AchievementCriteria | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "metric" in value &&
    "threshold" in value &&
    typeof (value as { threshold: unknown }).threshold === "number" &&
    (ACHIEVEMENT_METRICS as readonly string[]).includes(
      (value as { metric: unknown }).metric as string,
    )
  ) {
    return value as AchievementCriteria;
  }
  return null;
}

/**
 * Every metric an Achievement's criteriaJson can reference, computed once
 * from real activity rows (never a cached/derived-only field) and reused
 * across every candidate achievement so evaluating N achievements never
 * means N redundant queries.
 */
export async function computeStudentMetrics(
  prisma: PrismaClient,
  studentId: string,
): Promise<Record<AchievementMetric, number>> {
  const [streak, lessonsCompleted, quizzesPassed, experimentsCompleted, student] =
    await Promise.all([
      prisma.streak.findUnique({ where: { studentId } }),
      prisma.lessonProgress.count({ where: { studentId, status: "COMPLETED" } }),
      prisma.quizAttempt.count({ where: { studentId, status: "GRADED", passed: true } }),
      prisma.experimentAttempt.count({ where: { studentId, completedAt: { not: null } } }),
      prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } }),
    ]);

  return {
    // longestStreak, not currentStreak: an achievement earned by once
    // reaching a streak length must not disappear because the streak later
    // resets — StudentAchievement rows are permanent records.
    STREAK_DAYS: streak?.longestStreak ?? 0,
    LESSONS_COMPLETED: lessonsCompleted,
    QUIZZES_PASSED: quizzesPassed,
    EXPERIMENTS_COMPLETED: experimentsCompleted,
    GAME_POINTS: student.points,
  };
}

/**
 * Awards every non-custom achievement whose criteria the student's real,
 * current metrics now satisfy and that they don't already hold. Meant to
 * be called opportunistically right after any action that could move one
 * of these metrics (a quiz pass, an experiment completion, a game score, a
 * streak update) — no scheduler is available in this environment (same
 * pattern as syncExpiredSubscriptions()/reports/leaderboards).
 */
export async function evaluateAchievementsForStudent(
  prisma: PrismaClient,
  studentId: string,
) {
  const [candidates, alreadyEarned, student] = await Promise.all([
    prisma.achievement.findMany({ where: { isCustom: false } }),
    prisma.studentAchievement.findMany({
      where: { studentId },
      select: { achievementId: true },
    }),
    prisma.studentProfile.findUniqueOrThrow({
      where: { id: studentId },
      select: { userId: true },
    }),
  ]);

  const earnedIds = new Set(alreadyEarned.map((a) => a.achievementId));
  const unearned = candidates.filter((a) => !earnedIds.has(a.id));
  if (unearned.length === 0) return [];

  const metrics = await computeStudentMetrics(prisma, studentId);

  const newlyEarned = [];
  for (const achievement of unearned) {
    const criteria = asCriteria(achievement.criteriaJson);
    // Malformed/unrecognized criteria never silently "passes" — it just
    // never unlocks, same honesty stance as everywhere else in the app.
    if (!criteria) continue;
    if (metrics[criteria.metric] >= criteria.threshold) {
      // The @@unique([studentId, achievementId]) constraint is what
      // actually prevents a duplicate row when two triggers for the same
      // student race each other (e.g. a quiz-pass and a heartbeat's streak
      // update landing at nearly the same time) — the `earnedIds` check
      // above is only a fast path. Without this catch, the LOSER of that
      // race got an unhandled P2002 that failed its entire caller request
      // (e.g. a game-score submission whose points had already committed)
      // even though nothing was actually wrong: the achievement was simply
      // awarded a moment earlier by the other trigger.
      try {
        await prisma.studentAchievement.create({
          data: { studentId, achievementId: achievement.id },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) continue;
        throw error;
      }
      await notify(prisma, {
        userId: student.userId,
        type: "ACHIEVEMENT_UNLOCKED",
        title: "إنجاز جديد!",
        body: `حصلت على إنجاز "${achievement.title}"`,
        metadata: { achievementId: achievement.id },
      });
      newlyEarned.push(achievement);
    }
  }
  return newlyEarned;
}

/**
 * Custom (isCustom = true) achievements have no automatic criteria — a
 * teacher grants them by hand for recognition no computed metric can
 * honestly capture (a one-off event, special effort). The unique
 * (studentId, achievementId) constraint blocks double-awarding.
 */
export async function awardCustomAchievement(
  prisma: PrismaClient,
  params: { achievementId: string; studentId: string },
) {
  const achievement = await prisma.achievement.findUniqueOrThrow({
    where: { id: params.achievementId },
  });
  if (!achievement.isCustom) {
    throw new Error("لا يمكن منح إنجاز آلي يدويًا — يُمنح تلقائيًا عند تحقيق شرطه");
  }

  const existing = await prisma.studentAchievement.findUnique({
    where: {
      studentId_achievementId: {
        studentId: params.studentId,
        achievementId: params.achievementId,
      },
    },
  });
  if (existing) {
    throw new Error("حصل هذا الطالب على هذا الإنجاز بالفعل");
  }

  const student = await prisma.studentProfile.findUniqueOrThrow({
    where: { id: params.studentId },
    select: { userId: true },
  });

  const awarded = await prisma.studentAchievement.create({
    data: { studentId: params.studentId, achievementId: params.achievementId },
  });

  await notify(prisma, {
    userId: student.userId,
    type: "ACHIEVEMENT_UNLOCKED",
    title: "إنجاز جديد!",
    body: `حصلت على إنجاز "${achievement.title}"`,
    metadata: { achievementId: achievement.id },
  });

  return awarded;
}

export async function getStudentAchievements(prisma: PrismaClient, studentId: string) {
  const [allAchievements, earned, metrics] = await Promise.all([
    prisma.achievement.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.studentAchievement.findMany({ where: { studentId } }),
    computeStudentMetrics(prisma, studentId),
  ]);
  const earnedByAchievementId = new Map(earned.map((e) => [e.achievementId, e]));

  return allAchievements.map((achievement) => {
    const earnedRow = earnedByAchievementId.get(achievement.id);
    const criteria = asCriteria(achievement.criteriaJson);
    return {
      achievement,
      earnedAt: earnedRow?.earnedAt ?? null,
      progress: criteria ? { current: metrics[criteria.metric], threshold: criteria.threshold } : null,
    };
  });
}
