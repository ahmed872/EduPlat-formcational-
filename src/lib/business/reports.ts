import type { PrismaClient } from "@prisma/client";

export type ReportData = {
  totalStudySeconds: number;
  lessonsCompleted: number;
  quizzesTaken: number;
  quizzesPassed: number;
  averageQuizPercentage: number | null;
  experimentsCompleted: number;
};

/**
 * A report is a permanent, period-scoped snapshot — unlike the live
 * analytics in analytics.ts (always "as of now"), this captures exactly
 * what happened between periodStart and periodEnd so it stays accurate
 * even as the student keeps studying afterward.
 */
export async function generateParentReport(
  prisma: PrismaClient,
  params: { studentId: string; periodStart: Date; periodEnd: Date },
) {
  const { studentId, periodStart, periodEnd } = params;

  const [dailyStats, completedLessons, gradedAttempts, experimentAttempts] = await Promise.all([
    prisma.dailyStudyStat.findMany({
      where: { studentId, date: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.lessonProgress.count({
      where: {
        studentId,
        status: "COMPLETED",
        completedAt: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.quizAttempt.findMany({
      where: {
        studentId,
        status: "GRADED",
        submittedAt: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.experimentAttempt.count({
      where: {
        studentId,
        completedAt: { gte: periodStart, lte: periodEnd },
      },
    }),
  ]);

  const totalStudySeconds = dailyStats.reduce((sum, s) => sum + s.totalActiveSeconds, 0);
  const quizzesPassed = gradedAttempts.filter((a) => a.passed).length;
  const averageQuizPercentage = gradedAttempts.length
    ? gradedAttempts.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / gradedAttempts.length
    : null;

  const dataJson: ReportData = {
    totalStudySeconds,
    lessonsCompleted: completedLessons,
    quizzesTaken: gradedAttempts.length,
    quizzesPassed,
    averageQuizPercentage,
    experimentsCompleted: experimentAttempts,
  };

  return prisma.parentReport.create({
    data: {
      studentId,
      periodStart,
      periodEnd,
      dataJson: dataJson as never,
    },
  });
}

export async function getReportsForStudent(prisma: PrismaClient, studentId: string) {
  return prisma.parentReport.findMany({
    where: { studentId },
    orderBy: { periodStart: "desc" },
  });
}

export async function addTeacherCommentToReport(
  prisma: PrismaClient,
  params: { reportId: string; comment: string },
) {
  return prisma.parentReport.update({
    where: { id: params.reportId },
    data: { teacherComments: params.comment },
  });
}
