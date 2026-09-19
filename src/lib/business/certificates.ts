import type { PrismaClient } from "@prisma/client";
import { generateShortCode } from "@/lib/id";

/**
 * A course is "complete" when every one of its currently published
 * lessons has a COMPLETED LessonProgress row for this student — the same
 * definition analytics.ts's completionPercentage already uses, so a
 * certificate only ever appears once the student's own progress bar
 * already reads 100%, never before.
 */
async function hasCompletedCourse(
  prisma: PrismaClient,
  params: { studentId: string; courseId: string },
): Promise<boolean> {
  const lessons = await prisma.lesson.findMany({
    where: { courseId: params.courseId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (lessons.length === 0) return false;

  const completedCount = await prisma.lessonProgress.count({
    where: {
      studentId: params.studentId,
      lessonId: { in: lessons.map((l) => l.id) },
      status: "COMPLETED",
    },
  });
  return completedCount >= lessons.length;
}

/**
 * Issues a certificate the moment a course is genuinely fully completed —
 * idempotent (returns the existing certificate if one was already
 * issued) so it can be called opportunistically after every lesson
 * completion without ever double-issuing.
 */
export async function issueCertificateIfEligible(
  prisma: PrismaClient,
  params: { studentId: string; courseId: string },
) {
  const existing = await prisma.certificate.findFirst({
    where: { studentId: params.studentId, courseId: params.courseId },
  });
  if (existing) return existing;

  const eligible = await hasCompletedCourse(prisma, params);
  if (!eligible) return null;

  return prisma.certificate.create({
    data: {
      studentId: params.studentId,
      courseId: params.courseId,
      certificateCode: `CERT-${generateShortCode(10)}`,
    },
  });
}

export async function getCertificateByCode(prisma: PrismaClient, code: string) {
  return prisma.certificate.findUnique({
    where: { certificateCode: code },
    include: { student: { include: { user: true } }, course: true },
  });
}

export async function getCertificatesForStudent(prisma: PrismaClient, studentId: string) {
  return prisma.certificate.findMany({
    where: { studentId },
    include: { course: true },
    orderBy: { issuedAt: "desc" },
  });
}
