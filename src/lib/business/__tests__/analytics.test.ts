import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCourse, createLesson, createStudent, createVideo } from "@/test/factories";
import { createQuiz } from "@/test/factories-quiz";
import {
  getCourseAnalyticsForTeacher,
  getStudentCourseAnalytics,
  getStudentOverallAnalytics,
} from "@/lib/business/analytics";

beforeEach(async () => {
  await resetDatabase();
});

async function markLessonCompleted(studentId: string, lessonId: string) {
  await prisma.lessonProgress.create({
    data: { studentId, lessonId, status: "COMPLETED", completedAt: new Date() },
  });
}

async function gradeQuizAttempt(params: {
  quizId: string;
  studentId: string;
  percentage: number;
  passed: boolean;
}) {
  return prisma.quizAttempt.create({
    data: {
      quizId: params.quizId,
      studentId: params.studentId,
      attemptNumber: 1,
      status: "GRADED",
      percentage: params.percentage,
      passed: params.passed,
      submittedAt: new Date(),
    },
  });
}

async function entitle(studentId: string, lessonId: string) {
  return prisma.entitlement.create({
    data: { studentId, lessonId, reason: "FREE" },
  });
}

describe("getStudentCourseAnalytics", () => {
  it("computes completion percentage and quiz averages for a single course", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lessonA = await createLesson({ courseId: course.id });
    await createLesson({ courseId: course.id }); // second, uncompleted lesson

    await markLessonCompleted(student.id, lessonA.id);

    const quiz = await createQuiz({ lessonId: lessonA.id, passingScore: 60 });
    await gradeQuizAttempt({ quizId: quiz.id, studentId: student.id, percentage: 80, passed: true });

    const analytics = await getStudentCourseAnalytics(prisma, {
      studentId: student.id,
      courseId: course.id,
    });

    expect(analytics.totalLessons).toBe(2);
    expect(analytics.completedLessons).toBe(1);
    expect(analytics.completionPercentage).toBe(50);
    expect(analytics.quizzesTaken).toBe(1);
    expect(analytics.quizzesPassed).toBe(1);
    expect(analytics.averageQuizPercentage).toBe(80);
    expect(analytics.quizPassRate).toBe(100);
  });

  it("reports zero/null stats for a course with no lessons or attempts yet", async () => {
    const student = await createStudent();
    const course = await createCourse();

    const analytics = await getStudentCourseAnalytics(prisma, {
      studentId: student.id,
      courseId: course.id,
    });

    expect(analytics.totalLessons).toBe(0);
    expect(analytics.completionPercentage).toBe(0);
    expect(analytics.quizzesTaken).toBe(0);
    expect(analytics.averageQuizPercentage).toBeNull();
    expect(analytics.quizPassRate).toBeNull();
  });
});

describe("getStudentOverallAnalytics", () => {
  it("aggregates study time, lesson completion, quizzes, and experiments across all entitled courses", async () => {
    const student = await createStudent();
    const courseA = await createCourse();
    const courseB = await createCourse();
    const lessonA1 = await createLesson({ courseId: courseA.id });
    const lessonB1 = await createLesson({ courseId: courseB.id });

    await entitle(student.id, lessonA1.id);
    await entitle(student.id, lessonB1.id);
    await markLessonCompleted(student.id, lessonA1.id);
    await markLessonCompleted(student.id, lessonB1.id);

    const quizA = await createQuiz({ lessonId: lessonA1.id });
    await gradeQuizAttempt({ quizId: quizA.id, studentId: student.id, percentage: 90, passed: true });

    await prisma.dailyStudyStat.create({
      data: { studentId: student.id, date: new Date(2026, 0, 1), totalActiveSeconds: 600 },
    });
    await prisma.dailyStudyStat.create({
      data: { studentId: student.id, date: new Date(2026, 0, 2), totalActiveSeconds: 300 },
    });

    const experiment = await prisma.experiment.create({
      data: {
        lessonId: lessonA1.id,
        type: "INTERACTIVE",
        title: "exp",
        config: {},
      },
    });
    await prisma.experimentAttempt.create({
      data: { experimentId: experiment.id, studentId: student.id, completedAt: new Date() },
    });

    const overall = await getStudentOverallAnalytics(prisma, student.id);

    expect(overall.totalStudySeconds).toBe(900);
    expect(overall.totalLessonsCompleted).toBe(2);
    expect(overall.totalQuizzesTaken).toBe(1);
    expect(overall.totalQuizzesPassed).toBe(1);
    expect(overall.totalExperimentsCompleted).toBe(1);
    expect(overall.courses).toHaveLength(2);
  });

  it("counts a course reached only through a free lesson (no Entitlement row exists for those)", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const freeLesson = await createLesson({ courseId: course.id, isFree: true });
    const video = await createVideo({ lessonId: freeLesson.id, isFree: true });

    // Free videos are granted via checkVideoAccess's FREE_VIDEO bypass and
    // never get an Entitlement row — only the WatchSession this produces.
    await prisma.watchSession.create({
      data: { studentId: student.id, videoId: video.id, watchedSeconds: 30 },
    });

    const overall = await getStudentOverallAnalytics(prisma, student.id);

    expect(overall.courses).toHaveLength(1);
    expect(overall.courses[0].courseId).toBe(course.id);
  });

  it("returns an empty breakdown for a student with no entitlements", async () => {
    const student = await createStudent();
    const overall = await getStudentOverallAnalytics(prisma, student.id);

    expect(overall.totalStudySeconds).toBe(0);
    expect(overall.courses).toHaveLength(0);
  });
});

describe("getCourseAnalyticsForTeacher", () => {
  it("computes per-lesson completion funnel and per-student breakdown", async () => {
    const course = await createCourse();
    const lessonA = await createLesson({ courseId: course.id });
    const lessonB = await createLesson({ courseId: course.id });

    const studentA = await createStudent();
    const studentB = await createStudent();
    await entitle(studentA.id, lessonA.id);
    await entitle(studentA.id, lessonB.id);
    await entitle(studentB.id, lessonA.id);
    await entitle(studentB.id, lessonB.id);

    // Student A completes both lessons, student B completes only the first.
    await markLessonCompleted(studentA.id, lessonA.id);
    await markLessonCompleted(studentA.id, lessonB.id);
    await markLessonCompleted(studentB.id, lessonA.id);

    const analytics = await getCourseAnalyticsForTeacher(prisma, course.id);

    expect(analytics.enrolledStudentsCount).toBe(2);
    const funnelA = analytics.lessonFunnel.find((l) => l.lessonId === lessonA.id)!;
    const funnelB = analytics.lessonFunnel.find((l) => l.lessonId === lessonB.id)!;
    expect(funnelA.completedCount).toBe(2);
    expect(funnelA.completionRate).toBe(100);
    expect(funnelB.completedCount).toBe(1);
    expect(funnelB.completionRate).toBe(50);
    expect(analytics.averageCompletionPercentage).toBe(75);
    expect(analytics.students).toHaveLength(2);
  });

  it("counts a student as enrolled via watch history even with no Entitlement row", async () => {
    const course = await createCourse();
    const freeLesson = await createLesson({ courseId: course.id, isFree: true });
    const video = await createVideo({ lessonId: freeLesson.id, isFree: true });
    const student = await createStudent();

    await prisma.watchSession.create({
      data: { studentId: student.id, videoId: video.id, watchedSeconds: 30 },
    });

    const analytics = await getCourseAnalyticsForTeacher(prisma, course.id);

    expect(analytics.enrolledStudentsCount).toBe(1);
    expect(analytics.students).toHaveLength(1);
  });

  it("reports zero enrolled students for a course nobody has an entitlement to", async () => {
    const course = await createCourse();
    await createLesson({ courseId: course.id });

    const analytics = await getCourseAnalyticsForTeacher(prisma, course.id);

    expect(analytics.enrolledStudentsCount).toBe(0);
    expect(analytics.students).toHaveLength(0);
    expect(analytics.averageCompletionPercentage).toBe(0);
  });
});

describe("teacher course analytics — batched queries", () => {
  it("per-student figures equal the single-student computation, with a constant number of queries", async () => {
    const course = await createCourse();
    const lessons = await Promise.all([1, 2, 3].map(() => createLesson({ courseId: course.id })));
    const draft = await createLesson({ courseId: course.id, status: "DRAFT" });
    const quizzes = await Promise.all(lessons.map((l) => createQuiz({ lessonId: l.id })));
    const students = await Promise.all(Array.from({ length: 6 }, () => createStudent()));
    for (const [i, s] of students.entries()) {
      for (const l of lessons) await entitle(s.id, l.id);
      for (const l of lessons.slice(0, i % 4)) await markLessonCompleted(s.id, l.id);
      if (i % 2 === 0) await markLessonCompleted(s.id, draft.id); // unpublished lesson never counts
      if (i > 0) await gradeQuizAttempt({ quizId: quizzes[i % 3].id, studentId: s.id, percentage: 10 * i, passed: i > 2 });
      if (i > 3) {
        await prisma.quizAttempt.create({
          data: { quizId: quizzes[0].id, studentId: s.id, attemptNumber: 2, status: "GRADED", percentage: 95, passed: true, submittedAt: new Date() },
        });
      }
    }

    let queries = 0;
    const counted = prisma.$extends({
      query: { $allOperations: async ({ args, query }) => { queries++; return query(args); } },
    }) as unknown as typeof prisma;
    const teacherView = await getCourseAnalyticsForTeacher(counted, course.id);

    expect(teacherView.students).toHaveLength(6);
    for (const row of teacherView.students) {
      const single = await getStudentCourseAnalytics(prisma, { studentId: row.studentId, courseId: course.id });
      expect(row.completionPercentage).toBeCloseTo(single.completionPercentage, 10);
      expect(row.averageQuizPercentage).toEqual(single.averageQuizPercentage);
    }
    // Independent of the number of students (was ~3 queries per student).
    expect(queries).toBeLessThanOrEqual(8);
  });
});
