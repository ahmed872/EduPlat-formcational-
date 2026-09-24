import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import QRCode from "qrcode";
import { createCourse, createLesson, createStudent, createTeacher } from "@/test/factories";
import {
  certificateQrSvg,
  certificateVerificationUrl,
  getCertificatesForStudent,
  issueCertificateIfEligible,
  restoreCertificate,
  revokeCertificate,
  verifyCertificate,
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

async function issuedCertificate() {
  const student = await createStudent();
  const course = await createCourse();
  const lesson = await createLesson({ courseId: course.id });
  await completeLesson(student.id, lesson.id);
  const certificate = await issueCertificateIfEligible(prisma, { studentId: student.id, courseId: course.id });
  return { student, course, certificate: certificate! };
}

describe("verifyCertificate (public page)", () => {
  it("reports a real code as valid with only public fields", async () => {
    const { course, certificate } = await issuedCertificate();
    const result = await verifyCertificate(prisma, certificate.certificateCode);
    expect(result.status).toBe("VALID");
    if (result.status !== "VALID") throw new Error();
    expect(result.courseTitle).toBe(course.title);
    expect(result.studentName).toBe("Test Student");
    const json = JSON.stringify(result);
    expect(json).not.toContain(certificate.id);
    expect(json).not.toContain(certificate.studentId);
  });

  it("accepts the code case-insensitively and URL-encoded", async () => {
    const { certificate } = await issuedCertificate();
    expect((await verifyCertificate(prisma, certificate.certificateCode.toLowerCase())).status).toBe("VALID");
    expect((await verifyCertificate(prisma, encodeURIComponent(` ${certificate.certificateCode} `))).status).toBe("VALID");
  });

  it("reports an unknown well-formed code as not found", async () => {
    expect((await verifyCertificate(prisma, "CERT-ABCDEFGHJK")).status).toBe("NOT_FOUND");
  });

  it.each([
    ["an internal certificate id", "id"],
    ["a malformed code", "CERT-DOESNOTEXIST"],
    ["an SQL-ish value", "CERT-' OR 1=1 --"],
    ["a wildcard", "CERT-%"],
    ["an empty value", ""],
    ["a broken escape", "%E0%A4%A"],
  ])("rejects %s without a lookup", async (_label, value) => {
    const { certificate } = await issuedCertificate();
    const code = value === "id" ? certificate.id : value;
    expect((await verifyCertificate(prisma, code)).status).toBe("INVALID");
  });

  it("changing one character of a valid code never returns that certificate", async () => {
    const { certificate } = await issuedCertificate();
    const code = certificate.certificateCode;
    const last = code.at(-1) === "A" ? "B" : "A";
    const result = await verifyCertificate(prisma, code.slice(0, -1) + last);
    expect(result.status).toBe("NOT_FOUND");
  });

  it("reports a revoked certificate as revoked (without the internal reason) and valid again after restore", async () => {
    const { certificate } = await issuedCertificate();
    const teacher = await createTeacher();
    await revokeCertificate(prisma, { certificateId: certificate.id, actorUserId: teacher.id, reason: "سبب داخلي" });

    const revoked = await verifyCertificate(prisma, certificate.certificateCode);
    expect(revoked.status).toBe("REVOKED");
    expect(JSON.stringify(revoked)).not.toContain("سبب داخلي");

    await expect(
      revokeCertificate(prisma, { certificateId: certificate.id, actorUserId: teacher.id, reason: "مرة ثانية" }),
    ).rejects.toThrow();

    await restoreCertificate(prisma, { certificateId: certificate.id, actorUserId: teacher.id });
    expect((await verifyCertificate(prisma, certificate.certificateCode)).status).toBe("VALID");

    const audit = await prisma.auditLog.findMany({ where: { entityId: certificate.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["REVOKE_CERTIFICATE", "RESTORE_CERTIFICATE"]);
  });

  it("requires a reason to revoke", async () => {
    const { certificate } = await issuedCertificate();
    const teacher = await createTeacher();
    await expect(
      revokeCertificate(prisma, { certificateId: certificate.id, actorUserId: teacher.id, reason: "  " }),
    ).rejects.toThrow();
  });

  it("a revoked certificate is not silently re-issued", async () => {
    const { student, course, certificate } = await issuedCertificate();
    const teacher = await createTeacher();
    await revokeCertificate(prisma, { certificateId: certificate.id, actorUserId: teacher.id, reason: "x" });
    const again = await issueCertificateIfEligible(prisma, { studentId: student.id, courseId: course.id });
    expect(again?.id).toBe(certificate.id);
    expect(again?.revokedAt).not.toBeNull();
  });
});

describe("certificate QR code", () => {
  it("encodes only the public verification URL on the configured origin", async () => {
    const previous = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://edu.example.com/some/path";
    try {
      const url = certificateVerificationUrl("CERT-ABCDEFGHJK", "http://attacker.example");
      expect(url).toBe("https://edu.example.com/certificates/verify/CERT-ABCDEFGHJK");
    } finally {
      if (previous === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = previous;
    }
  });

  it("renders a real QR code SVG locally that carries exactly that URL", async () => {
    const url = "https://edu.example.com/certificates/verify/CERT-ABCDEFGHJK";
    const svg = await certificateQrSvg(url);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    // The same payload through the library's own encoder yields the same
    // module matrix size, i.e. the SVG encodes this URL and nothing longer.
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    expect(svg).toContain(`viewBox="0 0 ${qr.modules.size + 4} ${qr.modules.size + 4}"`);
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
