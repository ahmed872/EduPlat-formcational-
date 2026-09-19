import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCourse, createLesson, createStudent } from "@/test/factories";
import {
  getCertificateByCode,
  getCertificatesForStudent,
  issueCertificateIfEligible,
} from "@/lib/business/certificates";

beforeEach(async () => {
  await resetDatabase();
});

async function completeLesson(studentId: string, lessonId: string) {
  await prisma.lessonProgress.create({
    data: { studentId, lessonId, status: "COMPLETED", completedAt: new Date() },
  });
}

describe("issueCertificateIfEligible", () => {
  it("issues a certificate once every published lesson is completed", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson1 = await createLesson({ courseId: course.id });
    const lesson2 = await createLesson({ courseId: course.id });
    await completeLesson(student.id, lesson1.id);
    await completeLesson(student.id, lesson2.id);

    const certificate = await issueCertificateIfEligible(prisma, {
      studentId: student.id,
      courseId: course.id,
    });

    expect(certificate).not.toBeNull();
    expect(certificate!.certificateCode).toMatch(/^CERT-/);
  });

  it("does not issue a certificate while any published lesson is incomplete", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson1 = await createLesson({ courseId: course.id });
    await createLesson({ courseId: course.id }); // never completed
    await completeLesson(student.id, lesson1.id);

    const certificate = await issueCertificateIfEligible(prisma, {
      studentId: student.id,
      courseId: course.id,
    });

    expect(certificate).toBeNull();
  });

  it("does not issue a certificate for a course with no published lessons", async () => {
    const student = await createStudent();
    const course = await createCourse();

    const certificate = await issueCertificateIfEligible(prisma, {
      studentId: student.id,
      courseId: course.id,
    });

    expect(certificate).toBeNull();
  });

  it("is idempotent — never issues a second certificate for the same student and course", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    await completeLesson(student.id, lesson.id);

    const first = await issueCertificateIfEligible(prisma, {
      studentId: student.id,
      courseId: course.id,
    });
    const second = await issueCertificateIfEligible(prisma, {
      studentId: student.id,
      courseId: course.id,
    });

    expect(second!.id).toBe(first!.id);
    const count = await prisma.certificate.count({
      where: { studentId: student.id, courseId: course.id },
    });
    expect(count).toBe(1);
  });

  it("ignores an unpublished lesson when checking completion", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    await createLesson({ courseId: course.id, status: "DRAFT" });
    await completeLesson(student.id, lesson.id);

    const certificate = await issueCertificateIfEligible(prisma, {
      studentId: student.id,
      courseId: course.id,
    });

    expect(certificate).not.toBeNull();
  });
});

describe("getCertificateByCode", () => {
  it("returns null for an unknown code", async () => {
    const result = await getCertificateByCode(prisma, "CERT-DOESNOTEXIST");
    expect(result).toBeNull();
  });

  it("returns the certificate with student and course data for a real code", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    await completeLesson(student.id, lesson.id);
    const issued = await issueCertificateIfEligible(prisma, {
      studentId: student.id,
      courseId: course.id,
    });

    const found = await getCertificateByCode(prisma, issued!.certificateCode);
    expect(found?.course.id).toBe(course.id);
    expect(found?.student.id).toBe(student.id);
  });
});

describe("getCertificatesForStudent", () => {
  it("lists certificates newest-first", async () => {
    const student = await createStudent();
    const course1 = await createCourse();
    const course2 = await createCourse();
    const lesson1 = await createLesson({ courseId: course1.id });
    const lesson2 = await createLesson({ courseId: course2.id });
    await completeLesson(student.id, lesson1.id);
    await issueCertificateIfEligible(prisma, { studentId: student.id, courseId: course1.id });
    await completeLesson(student.id, lesson2.id);
    await issueCertificateIfEligible(prisma, { studentId: student.id, courseId: course2.id });

    const certificates = await getCertificatesForStudent(prisma, student.id);
    expect(certificates).toHaveLength(2);
    expect(certificates[0].courseId).toBe(course2.id);
  });
});
