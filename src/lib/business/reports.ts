import type { PrismaClient } from "@prisma/client";
import { getEnrolledPublishedLessonIds } from "@/lib/business/analytics";
import { assertParentCanAccessStudent } from "@/lib/business/parent-access";
import { ForbiddenError } from "@/lib/rbac";

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

  // Scoped to the exact same "enrolled published lesson" set analytics.ts
  // uses (see getEnrolledPublishedLessonIds) — previously this counted
  // lessonProgress/quizAttempt rows completely unscoped (any course, any
  // publish status), which could show a different lesson/quiz count here
  // than on the live analytics page for the same student and period (e.g.
  // a lesson unpublished after completion silently dropped out of
  // analytics but not out of a generated report). This was a real,
  // documented data-consistency gap from the final audit.
  const enrolledLessonIds = await getEnrolledPublishedLessonIds(prisma, studentId);

  const [dailyStats, completedLessons, gradedAttempts, experimentAttempts] = await Promise.all([
    prisma.dailyStudyStat.findMany({
      where: { studentId, date: { gte: periodStart, lte: periodEnd } },
    }),
    prisma.lessonProgress.count({
      where: {
        studentId,
        status: "COMPLETED",
        completedAt: { gte: periodStart, lte: periodEnd },
        lessonId: { in: enrolledLessonIds },
      },
    }),
    prisma.quizAttempt.findMany({
      where: {
        studentId,
        status: "GRADED",
        submittedAt: { gte: periodStart, lte: periodEnd },
        quiz: { lessonId: { in: enrolledLessonIds } },
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

/**
 * The single authorization gate for viewing / printing one report (the
 * printable page whose browser "Save as PDF" is the report PDF):
 *   - TEACHER_ADMIN: any report.
 *   - PARENT: only reports of a student they have an APPROVED link to, and
 *     only under that student's URL (a report id from another student in
 *     the same URL is refused, not silently shown).
 *   - anyone else: refused.
 * Refusals throw ForbiddenError; pages turn that into a 404 so report ids
 * can't be probed.
 */
export async function getReportForViewer(
  prisma: PrismaClient,
  params: { reportId: string; viewer: { userId: string; role: string }; studentId?: string },
) {
  const report = await prisma.parentReport.findUnique({
    where: { id: params.reportId },
    include: { student: { include: { user: { select: { name: true } } } } },
  });

  if (params.viewer.role === "TEACHER_ADMIN") {
    if (!report) throw new ForbiddenError("Report not found");
    return report;
  }
  if (params.viewer.role !== "PARENT") throw new ForbiddenError("Not allowed to view reports");
  if (!report || (params.studentId !== undefined && report.studentId !== params.studentId)) {
    throw new ForbiddenError("Report not found");
  }
  await assertParentCanAccessStudent(prisma, {
    parentUserId: params.viewer.userId,
    studentProfileId: report.studentId,
  });
  return report;
}
