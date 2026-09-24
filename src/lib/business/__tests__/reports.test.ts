import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createLesson, createParent, createStudent, createTeacher } from "@/test/factories";
import { createQuiz } from "@/test/factories-quiz";
import { getStudentOverallAnalytics } from "@/lib/business/analytics";
import {
  addTeacherCommentToReport,
  generateParentReport,
  getReportForViewer,
  getReportsForStudent,
} from "@/lib/business/reports";
import { ForbiddenError } from "@/lib/rbac";

beforeEach(async () => {
  await resetDatabase();
});

const JAN = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 31, 23, 59, 59) };
const FEB = { start: new Date(2026, 1, 1), end: new Date(2026, 1, 28, 23, 59, 59) };

/** Real completion always implies an Entitlement (paid) or a WatchSession
 * (free) on the lesson's course — see checkVideoAccess's FREE_VIDEO
 * bypass — so tests grant one to stay representative of the real gating
 * flow, the same way analytics.ts and reports.ts now both require it. */
async function grantEntitlement(studentId: string, lessonId: string) {
  await prisma.entitlement.create({
    data: { studentId, lessonId, reason: "ADMIN_GRANT" },
  });
}

describe("generateParentReport", () => {
  it("scopes every metric to the given period, excluding activity outside it", async () => {
    const student = await createStudent();
    const lessonJan = await createLesson();
    const lessonFeb = await createLesson();
    await grantEntitlement(student.id, lessonJan.id);
    await grantEntitlement(student.id, lessonFeb.id);

    await prisma.dailyStudyStat.create({
      data: { studentId: student.id, date: new Date(2026, 0, 15), totalActiveSeconds: 600 },
    });
    await prisma.dailyStudyStat.create({
      data: { studentId: student.id, date: new Date(2026, 1, 15), totalActiveSeconds: 900 },
    });

    await prisma.lessonProgress.create({
      data: {
        studentId: student.id,
        lessonId: lessonJan.id,
        status: "COMPLETED",
        completedAt: new Date(2026, 0, 10),
      },
    });
    await prisma.lessonProgress.create({
      data: {
        studentId: student.id,
        lessonId: lessonFeb.id,
        status: "COMPLETED",
        completedAt: new Date(2026, 1, 10),
      },
    });

    const quiz = await createQuiz({ lessonId: lessonJan.id });
    await prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        studentId: student.id,
        attemptNumber: 1,
        status: "GRADED",
        percentage: 80,
        passed: true,
        submittedAt: new Date(2026, 0, 20),
      },
    });
    await prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        studentId: student.id,
        attemptNumber: 2,
        status: "GRADED",
        percentage: 40,
        passed: false,
        submittedAt: new Date(2026, 1, 20),
      },
    });

    const report = await generateParentReport(prisma, {
      studentId: student.id,
      periodStart: JAN.start,
      periodEnd: JAN.end,
    });

    const data = report.dataJson as {
      totalStudySeconds: number;
      lessonsCompleted: number;
      quizzesTaken: number;
      quizzesPassed: number;
      averageQuizPercentage: number | null;
    };
    expect(data.totalStudySeconds).toBe(600);
    expect(data.lessonsCompleted).toBe(1);
    expect(data.quizzesTaken).toBe(1);
    expect(data.quizzesPassed).toBe(1);
    expect(data.averageQuizPercentage).toBe(80);
  });

  it("returns null average and zero counts for a period with no activity", async () => {
    const student = await createStudent();

    const report = await generateParentReport(prisma, {
      studentId: student.id,
      periodStart: FEB.start,
      periodEnd: FEB.end,
    });

    const data = report.dataJson as { quizzesTaken: number; averageQuizPercentage: number | null };
    expect(data.quizzesTaken).toBe(0);
    expect(data.averageQuizPercentage).toBeNull();
  });

  // Regression coverage for the final audit's "Analytics vs. Reports metric
  // divergence" gap: reports.ts used to count lessonProgress/quizAttempt
  // rows with no lesson/course scoping at all, while analytics.ts scoped
  // the same metrics to published lessons in courses the student is
  // entitled to or has watched. Unpublishing a lesson after completion
  // used to silently drop it from analytics but not from a report for the
  // same period — the two are now defined by the exact same
  // getEnrolledPublishedLessonIds() set, so they can never disagree.
  it("agrees with getStudentOverallAnalytics on lessons/quizzes completed for the same period", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    await grantEntitlement(student.id, lesson.id);

    await prisma.lessonProgress.create({
      data: {
        studentId: student.id,
        lessonId: lesson.id,
        status: "COMPLETED",
        completedAt: new Date(2026, 0, 10),
      },
    });
    const quiz = await createQuiz({ lessonId: lesson.id });
    await prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        studentId: student.id,
        attemptNumber: 1,
        status: "GRADED",
        percentage: 90,
        passed: true,
        submittedAt: new Date(2026, 0, 15),
      },
    });

    const report = await generateParentReport(prisma, {
      studentId: student.id,
      periodStart: JAN.start,
      periodEnd: JAN.end,
    });
    const analytics = await getStudentOverallAnalytics(prisma, student.id);

    const data = report.dataJson as { lessonsCompleted: number; quizzesTaken: number };
    expect(data.lessonsCompleted).toBe(analytics.totalLessonsCompleted);
    expect(data.quizzesTaken).toBe(analytics.totalQuizzesTaken);
    expect(data.lessonsCompleted).toBe(1);
    expect(data.quizzesTaken).toBe(1);
  });

  it("excludes a completed lesson's progress once its lesson is unpublished, matching analytics", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    await grantEntitlement(student.id, lesson.id);
    await prisma.lessonProgress.create({
      data: {
        studentId: student.id,
        lessonId: lesson.id,
        status: "COMPLETED",
        completedAt: new Date(2026, 0, 10),
      },
    });

    // Unpublish after completion — analytics.ts only ever counts currently
    // PUBLISHED lessons; before this fix, reports.ts had no such filter and
    // would have kept counting this lesson forever.
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: "DRAFT" } });

    const report = await generateParentReport(prisma, {
      studentId: student.id,
      periodStart: JAN.start,
      periodEnd: JAN.end,
    });
    const analytics = await getStudentOverallAnalytics(prisma, student.id);

    const data = report.dataJson as { lessonsCompleted: number };
    expect(data.lessonsCompleted).toBe(0);
    expect(analytics.totalLessonsCompleted).toBe(0);
  });
});

describe("getReportsForStudent", () => {
  it("lists a student's reports most-recent-period first", async () => {
    const student = await createStudent();
    await generateParentReport(prisma, {
      studentId: student.id,
      periodStart: JAN.start,
      periodEnd: JAN.end,
    });
    await generateParentReport(prisma, {
      studentId: student.id,
      periodStart: FEB.start,
      periodEnd: FEB.end,
    });

    const reports = await getReportsForStudent(prisma, student.id);

    expect(reports).toHaveLength(2);
    expect(reports[0].periodStart.getTime()).toBe(FEB.start.getTime());
  });
});

describe("addTeacherCommentToReport", () => {
  it("attaches a comment to an existing report", async () => {
    const student = await createStudent();
    const report = await generateParentReport(prisma, {
      studentId: student.id,
      periodStart: JAN.start,
      periodEnd: JAN.end,
    });

    const updated = await addTeacherCommentToReport(prisma, {
      reportId: report.id,
      comment: "أداء ممتاز هذا الشهر",
    });

    expect(updated.teacherComments).toBe("أداء ممتاز هذا الشهر");
  });
});

describe("getReportForViewer (report preview / PDF authorization)", () => {
  async function setup() {
    const student = await createStudent();
    const report = await generateParentReport(prisma, {
      studentId: student.id,
      periodStart: JAN.start,
      periodEnd: JAN.end,
    });
    const parent = await createParent();
    await prisma.parentStudent.create({
      data: { parentId: parent.id, studentId: student.id, approvedAt: new Date() },
    });
    return { student, report, parent };
  }

  it("lets an approved linked parent open their child's report", async () => {
    const { student, report, parent } = await setup();
    const found = await getReportForViewer(prisma, {
      reportId: report.id,
      studentId: student.id,
      viewer: { userId: parent.userId, role: "PARENT" },
    });
    expect(found.id).toBe(report.id);
    expect(found.student.user.name).toBe("Test Student");
  });

  it("refuses an unlinked parent", async () => {
    const { student, report } = await setup();
    const stranger = await createParent();
    await expect(
      getReportForViewer(prisma, {
        reportId: report.id,
        studentId: student.id,
        viewer: { userId: stranger.userId, role: "PARENT" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a parent whose link is not approved yet", async () => {
    const { student, report } = await setup();
    const pending = await createParent();
    await prisma.parentStudent.create({ data: { parentId: pending.id, studentId: student.id } });
    await expect(
      getReportForViewer(prisma, {
        reportId: report.id,
        studentId: student.id,
        viewer: { userId: pending.userId, role: "PARENT" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses another student's report id placed under the parent's own child URL", async () => {
    const { student, parent } = await setup();
    const otherStudent = await createStudent();
    const otherReport = await generateParentReport(prisma, {
      studentId: otherStudent.id,
      periodStart: JAN.start,
      periodEnd: JAN.end,
    });
    await expect(
      getReportForViewer(prisma, {
        reportId: otherReport.id,
        studentId: student.id,
        viewer: { userId: parent.userId, role: "PARENT" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // …and under the other student's URL, the missing link refuses it too.
    await expect(
      getReportForViewer(prisma, {
        reportId: otherReport.id,
        studentId: otherStudent.id,
        viewer: { userId: parent.userId, role: "PARENT" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets a teacher open any report", async () => {
    const { report } = await setup();
    const teacher = await createTeacher();
    const found = await getReportForViewer(prisma, {
      reportId: report.id,
      viewer: { userId: teacher.id, role: "TEACHER_ADMIN" },
    });
    expect(found.id).toBe(report.id);
  });

  it("refuses students (including the report's own student) and unknown roles", async () => {
    const { student, report } = await setup();
    for (const role of ["STUDENT", "SOMETHING"]) {
      await expect(
        getReportForViewer(prisma, {
          reportId: report.id,
          studentId: student.id,
          viewer: { userId: student.userId, role },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("returns the same refusal for a missing report as for a forbidden one", async () => {
    const { student, parent } = await setup();
    await expect(
      getReportForViewer(prisma, {
        reportId: "missing",
        studentId: student.id,
        viewer: { userId: parent.userId, role: "PARENT" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const teacher = await createTeacher();
    await expect(
      getReportForViewer(prisma, { reportId: "missing", viewer: { userId: teacher.id, role: "TEACHER_ADMIN" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
