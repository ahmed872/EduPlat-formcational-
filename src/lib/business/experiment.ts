import type { PrismaClient } from "@prisma/client";

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

/**
 * A student may retry an experiment freely; this reuses an already-started
 * but not-yet-completed attempt rather than piling up abandoned rows.
 */
export async function startExperimentAttempt(
  prisma: PrismaClient,
  params: { experimentId: string; studentId: string },
) {
  const existing = await prisma.experimentAttempt.findFirst({
    where: {
      experimentId: params.experimentId,
      studentId: params.studentId,
      completedAt: null,
    },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return existing;

  return prisma.experimentAttempt.create({
    data: {
      experimentId: params.experimentId,
      studentId: params.studentId,
    },
  });
}

export async function completeExperimentAttempt(
  prisma: PrismaClient,
  params: { attemptId: string; studentId: string; resultJson?: unknown },
) {
  const attempt = await prisma.experimentAttempt.findUniqueOrThrow({
    where: { id: params.attemptId },
  });
  if (attempt.studentId !== params.studentId) {
    throw new Error("لا يمكنك إنهاء تجربة طالب آخر");
  }

  return prisma.experimentAttempt.update({
    where: { id: params.attemptId },
    data: {
      completedAt: new Date(),
      resultJson: (params.resultJson ?? null) as never,
    },
  });
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
