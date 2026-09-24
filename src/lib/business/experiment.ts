import type { PrismaClient } from "@prisma/client";
import { evaluateAchievementsForStudent } from "@/lib/business/achievements";
import { assertStudentCanUseLesson } from "@/lib/business/content-visibility";
import {
  applyMiniGameMove,
  attemptExpired,
  gradeMiniGame,
  gradeSubmission,
  initialMiniGameState,
  resolveExperiment,
  toPublicExperiment,
  type MiniGameState,
} from "@/lib/experiments/definitions";

export async function getExperimentsWithStatus(
  prisma: PrismaClient,
  params: { lessonId: string; studentId: string },
) {
  const experiments = await prisma.experiment.findMany({
    where: { lessonId: params.lessonId },
    orderBy: { order: "asc" },
    include: {
      attempts: {
        where: { studentId: params.studentId },
        orderBy: { startedAt: "desc" },
      },
    },
  });

  return experiments.map((experiment) => {
    const latestAttempt = experiment.attempts[0] ?? null;
    const completed = experiment.attempts.some((a) => a.completedAt !== null);
    return { experiment, latestAttempt, completed };
  });
}

type AttemptResult = {
  passed: boolean;
  message: string;
  score: number;
  maxScore: number;
  detail?: Record<string, unknown>;
};

async function loadAccessibleExperiment(
  prisma: PrismaClient,
  params: { experimentId: string; studentId: string },
) {
  const experiment = await prisma.experiment.findUnique({ where: { id: params.experimentId } });
  if (!experiment) throw new Error("التجربة غير موجودة");
  // Entitlement + publication + prerequisite chain, checked on every call —
  // never only by the page that happens to render the experiment.
  await assertStudentCanUseLesson(prisma, {
    studentId: params.studentId,
    lessonId: experiment.lessonId,
  });
  const resolved = resolveExperiment(experiment);
  if (!resolved) throw new Error("إعدادات هذه التجربة غير صالحة — يرجى التواصل مع المعلم");
  return { experiment, resolved };
}

/** An attempt that is still open: neither passed nor closed as a failed round. */
const OPEN_ATTEMPT = { completedAt: null, endedAt: null } as const;

/**
 * Starts (or resumes) the student's attempt. A student may retry freely:
 * an open attempt is reused rather than piling up abandoned rows.
 */
export async function startExperimentAttempt(
  prisma: PrismaClient,
  params: { experimentId: string; studentId: string },
) {
  const { resolved } = await loadAccessibleExperiment(prisma, params);

  const existing = await prisma.experimentAttempt.findFirst({
    where: { experimentId: params.experimentId, studentId: params.studentId, ...OPEN_ATTEMPT },
    orderBy: { startedAt: "desc" },
  });
  if (existing) {
    if (!attemptExpired(resolved, existing.startedAt, new Date())) return existing;
    // A dead round (time limit passed / abandoned long ago) is closed, never
    // resumed — otherwise one attempt could be kept "open" indefinitely.
    await prisma.experimentAttempt.updateMany({
      where: { id: existing.id, ...OPEN_ATTEMPT },
      data: { endedAt: new Date() },
    });
  }

  return prisma.experimentAttempt.create({
    data: {
      experimentId: params.experimentId,
      studentId: params.studentId,
      resultJson:
        resolved.kind === "MINI_GAME"
          ? ({ state: initialMiniGameState(resolved.config) } as never)
          : undefined,
    },
  });
}

async function loadOwnOpenAttempt(
  prisma: PrismaClient,
  params: { attemptId: string; studentId: string },
) {
  const attempt = await prisma.experimentAttempt.findUnique({ where: { id: params.attemptId } });
  // Same error for "not found" and "someone else's" so ids can't be probed.
  if (!attempt || attempt.studentId !== params.studentId) {
    throw new Error("محاولة غير موجودة");
  }
  if (attempt.completedAt || attempt.endedAt) throw new Error("هذه المحاولة منتهية بالفعل");
  const { resolved } = await loadAccessibleExperiment(prisma, {
    experimentId: attempt.experimentId,
    studentId: params.studentId,
  });
  return { attempt, resolved };
}

/**
 * Closes an attempt atomically — the `completedAt/endedAt IS NULL` guard
 * means two concurrent submissions can't both finalize the same attempt.
 */
async function closeAttempt(
  prisma: PrismaClient,
  attemptId: string,
  data: { passed: boolean; resultJson: unknown },
) {
  const now = new Date();
  const { count } = await prisma.experimentAttempt.updateMany({
    where: { id: attemptId, ...OPEN_ATTEMPT },
    data: {
      endedAt: now,
      completedAt: data.passed ? now : null,
      resultJson: data.resultJson as never,
    },
  });
  if (count === 0) throw new Error("هذه المحاولة منتهية بالفعل");
}

/**
 * Submits a single-shot experiment (drag & drop, ordering, simulation,
 * legacy steps). The server grades it; the attempt completes only on a
 * pass. A failed try is recorded but leaves the attempt open for a retry.
 * A malformed submission (e.g. empty) is rejected outright — never a pass.
 */
export async function submitExperimentAttempt(
  prisma: PrismaClient,
  params: { attemptId: string; studentId: string; submission: unknown },
): Promise<AttemptResult> {
  const { attempt, resolved } = await loadOwnOpenAttempt(prisma, params);
  if (resolved.kind === "MINI_GAME") throw new Error("هذه اللعبة تُلعب خطوة بخطوة");

  const result = gradeSubmission(resolved, params.submission);
  const previous = (attempt.resultJson ?? {}) as { tries?: number };
  const resultJson = {
    tries: (previous.tries ?? 0) + 1,
    score: result.score,
    maxScore: result.maxScore,
    passed: result.passed,
    ...(result.detail ? { detail: result.detail } : {}),
  };

  if (result.passed) {
    await closeAttempt(prisma, attempt.id, { passed: true, resultJson });
    await evaluateAchievementsForStudent(prisma, params.studentId);
  } else {
    await prisma.experimentAttempt.update({
      where: { id: attempt.id },
      data: { resultJson: resultJson as never },
    });
  }
  return result;
}

export type MoveResult = {
  /** Right or wrong only — the correct choice is never sent back. */
  correct: boolean | null;
  state: MiniGameState;
  finished: AttemptResult | null;
};

/**
 * One move of a mini game. The game state (answers, lives, streak) lives
 * server-side on the attempt, and the time limit is measured from the
 * attempt's server-side start — the browser only renders what it is told.
 */
export async function playExperimentMove(
  prisma: PrismaClient,
  params: { attemptId: string; studentId: string; move: unknown; now?: Date },
): Promise<MoveResult> {
  const { attempt, resolved } = await loadOwnOpenAttempt(prisma, params);
  if (resolved.kind !== "MINI_GAME") throw new Error("هذه التجربة لا تُلعب خطوة بخطوة");

  const stored = (attempt.resultJson ?? {}) as { state?: MiniGameState };
  const state = stored.state ?? initialMiniGameState(resolved.config);
  const elapsedMs = (params.now ?? new Date()).getTime() - attempt.startedAt.getTime();
  const outcome = applyMiniGameMove(resolved.config, state, params.move, elapsedMs);

  if (!outcome.state.done) {
    // Optimistic concurrency on the number of answers already recorded, so
    // two parallel moves can't both be applied on top of the same state.
    const { count } = await prisma.experimentAttempt.updateMany({
      where: {
        id: attempt.id,
        ...OPEN_ATTEMPT,
        resultJson: { path: ["state", "answers"], equals: state.answers as never },
      },
      data: { resultJson: { state: outcome.state } as never },
    });
    if (count === 0) throw new Error("تم تسجيل حركة أخرى في نفس الوقت — أعد المحاولة");
    return { correct: outcome.correct, state: outcome.state, finished: null };
  }

  const graded = gradeMiniGame(resolved.config, outcome.state);
  await closeAttempt(prisma, attempt.id, {
    passed: graded.passed,
    resultJson: {
      state: outcome.state,
      score: graded.score,
      maxScore: graded.maxScore,
      passed: graded.passed,
    },
  });
  if (graded.passed) await evaluateAchievementsForStudent(prisma, params.studentId);
  return { correct: outcome.correct, state: outcome.state, finished: graded };
}

/**
 * Everything the student page needs, after the same access check the
 * actions enforce: only the public projection of the experiment (never the
 * answer key), the open attempt (if any) and whether it was ever passed.
 */
export async function getExperimentForStudent(
  prisma: PrismaClient,
  params: { experimentId: string; studentId: string },
) {
  const { experiment, resolved } = await loadAccessibleExperiment(prisma, params);
  const attempts = await prisma.experimentAttempt.findMany({
    where: { experimentId: experiment.id, studentId: params.studentId },
    orderBy: { startedAt: "desc" },
  });
  const now = new Date();
  const openAttempt =
    attempts.find((a) => !a.completedAt && !a.endedAt && !attemptExpired(resolved, a.startedAt, now)) ?? null;
  return {
    experiment: { id: experiment.id, title: experiment.title, isRequired: experiment.isRequired, lessonId: experiment.lessonId },
    publicExperiment: toPublicExperiment(resolved),
    openAttempt: openAttempt
      ? {
          id: openAttempt.id,
          startedAt: openAttempt.startedAt,
          state: ((openAttempt.resultJson ?? {}) as { state?: MiniGameState }).state ?? null,
        }
      : null,
    completed: attempts.some((a) => a.completedAt !== null),
  };
}

/**
 * Gates the lesson's quiz (and by extension "next lesson" progression):
 * every experiment marked isRequired for the lesson must have at least one
 * completed attempt by this student. Optional experiments never block.
 */
export async function allRequiredExperimentsCompleted(
  prisma: PrismaClient,
  params: { lessonId: string; studentId: string },
): Promise<boolean> {
  const requiredExperiments = await prisma.experiment.findMany({
    where: { lessonId: params.lessonId, isRequired: true },
    select: { id: true },
  });
  if (requiredExperiments.length === 0) return true;

  const completedCount = await prisma.experimentAttempt.count({
    where: {
      studentId: params.studentId,
      completedAt: { not: null },
      experimentId: { in: requiredExperiments.map((e) => e.id) },
    },
  });

  // Not exact (a student could complete the same required experiment twice
  // instead of two different ones), so verify distinct experiment coverage.
  if (completedCount < requiredExperiments.length) return false;

  const completedAttempts = await prisma.experimentAttempt.findMany({
    where: {
      studentId: params.studentId,
      completedAt: { not: null },
      experimentId: { in: requiredExperiments.map((e) => e.id) },
    },
    select: { experimentId: true },
  });
  const completedExperimentIds = new Set(completedAttempts.map((a) => a.experimentId));
  return requiredExperiments.every((e) => completedExperimentIds.has(e.id));
}
