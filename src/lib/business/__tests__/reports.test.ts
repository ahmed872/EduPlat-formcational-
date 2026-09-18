import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createLesson, createStudent } from "@/test/factories";
import { createQuiz } from "@/test/factories-quiz";
import {
  addTeacherCommentToReport,
  generateParentReport,
  getReportsForStudent,
} from "@/lib/business/reports";

beforeEach(async () => {
  await resetDatabase();
});

const JAN = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 31, 23, 59, 59) };
const FEB = { start: new Date(2026, 1, 1), end: new Date(2026, 1, 28, 23, 59, 59) };

describe("generateParentReport", () => {
  it("scopes every metric to the given period, excluding activity outside it", async () => {
    const student = await createStudent();
    const lessonJan = await createLesson();
    const lessonFeb = await createLesson();

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

    const quiz = await createQuiz();
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
