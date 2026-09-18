import type { PrismaClient } from "@prisma/client";

export type CourseAnalytics = {
  courseId: string;
  courseTitle: string;
  totalLessons: number;
  completedLessons: number;
  completionPercentage: number;
  quizzesTaken: number;
  quizzesPassed: number;
  averageQuizPercentage: number | null;
  quizPassRate: number | null;
};

async function computeCourseAnalyticsForStudent(
  prisma: PrismaClient,
  params: { studentId: string; courseId: string },
) {
  const lessons = await prisma.lesson.findMany({
    where: { courseId: params.courseId, status: "PUBLISHED" },
    select: { id: true },
  });
  const lessonIds = lessons.map((l) => l.id);

  const [progressRows, gradedAttempts] = await Promise.all([
    prisma.lessonProgress.findMany({
      where: { studentId: params.studentId, lessonId: { in: lessonIds } },
    }),
    prisma.quizAttempt.findMany({
      where: {
        studentId: params.studentId,
        status: "GRADED",
        quiz: { lessonId: { in: lessonIds } },
      },
    }),
  ]);

  const completedLessons = progressRows.filter((p) => p.status === "COMPLETED").length;
  const completionPercentage = lessonIds.length > 0 ? (completedLessons / lessonIds.length) * 100 : 0;

  const quizzesPassed = gradedAttempts.filter((a) => a.passed).length;
  const averageQuizPercentage = gradedAttempts.length
    ? gradedAttempts.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / gradedAttempts.length
    : null;
  const quizPassRate = gradedAttempts.length ? (quizzesPassed / gradedAttempts.length) * 100 : null;

  return {
    totalLessons: lessonIds.length,
    completedLessons,
    completionPercentage,
    quizzesTaken: gradedAttempts.length,
    quizzesPassed,
    averageQuizPercentage,
    quizPassRate,
  };
}

export async function getStudentCourseAnalytics(
  prisma: PrismaClient,
  params: { studentId: string; courseId: string },
): Promise<CourseAnalytics> {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: params.courseId } });
  const stats = await computeCourseAnalyticsForStudent(prisma, params);
  return { courseId: course.id, courseTitle: course.title, ...stats };
}

export async function getStudentOverallAnalytics(
  prisma: PrismaClient,
  studentId: string,
) {
  const [entitlements, watchSessions, dailyStats, experimentAttempts] = await Promise.all([
    prisma.entitlement.findMany({
      where: { studentId, revokedAt: null, lessonId: { not: null } },
      include: { lesson: { include: { course: true } } },
    }),
    // A free lesson never gets an Entitlement row (see checkVideoAccess's
    // FREE_VIDEO bypass), so a student who only ever watched free content
    // would otherwise vanish from their own analytics entirely — watch
    // history is the other real signal that a course is "theirs".
    prisma.watchSession.findMany({
      where: { studentId },
      include: { video: { include: { lesson: true } } },
    }),
    prisma.dailyStudyStat.findMany({ where: { studentId } }),
    prisma.experimentAttempt.count({
      where: { studentId, completedAt: { not: null } },
    }),
  ]);

  const courseIds = Array.from(
    new Set(
      [
        ...entitlements.map((e) => e.lesson?.courseId),
        ...watchSessions.map((w) => w.video.lesson?.courseId),
      ].filter((id): id is string => Boolean(id)),
    ),
  );

  const courses = await Promise.all(
    courseIds.map((courseId) => getStudentCourseAnalytics(prisma, { studentId, courseId })),
  );

  const totalStudySeconds = dailyStats.reduce((sum, s) => sum + s.totalActiveSeconds, 0);
  const totalLessonsCompleted = courses.reduce((sum, c) => sum + c.completedLessons, 0);
  const totalQuizzesTaken = courses.reduce((sum, c) => sum + c.quizzesTaken, 0);
  const totalQuizzesPassed = courses.reduce((sum, c) => sum + c.quizzesPassed, 0);

  return {
    totalStudySeconds,
    totalLessonsCompleted,
    totalQuizzesTaken,
    totalQuizzesPassed,
    totalExperimentsCompleted: experimentAttempts,
    courses,
  };
}

export type LessonCompletionFunnel = {
  lessonId: string;
  title: string;
  completedCount: number;
  completionRate: number;
};

export async function getCourseAnalyticsForTeacher(
  prisma: PrismaClient,
  courseId: string,
) {
  const [course, lessons, entitlements, watchSessions] = await Promise.all([
    prisma.course.findUniqueOrThrow({ where: { id: courseId } }),
    prisma.lesson.findMany({
      where: { courseId, status: "PUBLISHED" },
      orderBy: { order: "asc" },
    }),
    prisma.entitlement.findMany({
      where: { revokedAt: null, lesson: { courseId } },
      select: { studentId: true },
    }),
    // Free lessons never create an Entitlement row, so a student who only
    // watched free content in this course would otherwise never count as
    // "enrolled" for the teacher's analytics — watch history closes that.
    prisma.watchSession.findMany({
      where: { video: { lesson: { courseId } } },
      select: { studentId: true },
    }),
  ]);

  const enrolledStudentIds = Array.from(
    new Set([
      ...entitlements.map((e) => e.studentId),
      ...watchSessions.map((w) => w.studentId),
    ]),
  );
  const lessonIds = lessons.map((l) => l.id);

  const [progressRows, students] = await Promise.all([
    prisma.lessonProgress.findMany({
      where: { lessonId: { in: lessonIds }, studentId: { in: enrolledStudentIds } },
    }),
    prisma.studentProfile.findMany({
      where: { id: { in: enrolledStudentIds } },
      include: { user: true },
    }),
  ]);

  const lessonFunnel: LessonCompletionFunnel[] = lessons.map((lesson) => {
    const completedCount = progressRows.filter(
      (p) => p.lessonId === lesson.id && p.status === "COMPLETED",
    ).length;
    return {
      lessonId: lesson.id,
      title: lesson.title,
      completedCount,
      completionRate:
        enrolledStudentIds.length > 0 ? (completedCount / enrolledStudentIds.length) * 100 : 0,
    };
  });

  const studentBreakdown = await Promise.all(
    students.map(async (student) => {
      const stats = await computeCourseAnalyticsForStudent(prisma, {
        studentId: student.id,
        courseId,
      });
      return {
        studentId: student.id,
        name: student.user.name,
        completionPercentage: stats.completionPercentage,
        averageQuizPercentage: stats.averageQuizPercentage,
      };
    }),
  );

  const averageCompletionPercentage = studentBreakdown.length
    ? studentBreakdown.reduce((sum, s) => sum + s.completionPercentage, 0) / studentBreakdown.length
    : 0;
  const gradedQuizStudents = studentBreakdown.filter((s) => s.averageQuizPercentage !== null);
  const averageQuizPercentage = gradedQuizStudents.length
    ? gradedQuizStudents.reduce((sum, s) => sum + (s.averageQuizPercentage ?? 0), 0) /
      gradedQuizStudents.length
    : null;

  return {
    courseId: course.id,
    courseTitle: course.title,
    enrolledStudentsCount: enrolledStudentIds.length,
    lessonFunnel,
    averageCompletionPercentage,
    averageQuizPercentage,
    students: studentBreakdown,
  };
}
