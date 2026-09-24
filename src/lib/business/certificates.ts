import type { PrismaClient } from "@prisma/client";
import QRCode from "qrcode";
import { generateShortCode } from "@/lib/id";
import { isUniqueConstraintError } from "@/lib/prisma-errors";

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

  // The `existing` check above is a plain read — two concurrent completion
  // triggers for the same student+course (e.g. two lessons finalizing at
  // nearly the same time) could both pass it before either insert lands.
  // The real backstop is the @@unique([studentId, courseId]) constraint on
  // Certificate: whichever request loses the race gets a clean "already
  // issued, fetch the real one" instead of a duplicate row or a raw crash.
  try {
    return await prisma.certificate.create({
      data: {
        studentId: params.studentId,
        courseId: params.courseId,
        certificateCode: `CERT-${generateShortCode(10)}`,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return prisma.certificate.findFirstOrThrow({
        where: { studentId: params.studentId, courseId: params.courseId },
      });
    }
    throw error;
  }
}

export async function getCertificatesForStudent(prisma: PrismaClient, studentId: string) {
  return prisma.certificate.findMany({
    where: { studentId },
    include: { course: true },
    orderBy: { issuedAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Public verification + QR code
// ---------------------------------------------------------------------------

/** Every issued code has exactly this shape (see issueCertificateIfEligible). */
const CERTIFICATE_CODE = /^CERT-[A-HJ-NP-Z2-9]{10}$/;

export function normalizeCertificateCode(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = decoded.trim().toUpperCase();
  return CERTIFICATE_CODE.test(code) ? code : null;
}

export type CertificateVerification =
  | { status: "INVALID" }
  | { status: "NOT_FOUND" }
  | {
      status: "VALID" | "REVOKED";
      code: string;
      studentName: string;
      courseTitle: string;
      issuedAt: Date;
      revokedAt: Date | null;
    };

/**
 * What the public (no login) verification page may show. Looks up only by
 * the exact code — nothing else from the URL is trusted — and never returns
 * internal ids or the teacher's revocation reason.
 */
export async function verifyCertificate(prisma: PrismaClient, rawCode: string): Promise<CertificateVerification> {
  const code = normalizeCertificateCode(rawCode);
  if (!code) return { status: "INVALID" };
  const certificate = await prisma.certificate.findUnique({
    where: { certificateCode: code },
    select: {
      certificateCode: true,
      issuedAt: true,
      revokedAt: true,
      student: { select: { user: { select: { name: true } } } },
      course: { select: { title: true } },
    },
  });
  if (!certificate) return { status: "NOT_FOUND" };
  return {
    status: certificate.revokedAt ? "REVOKED" : "VALID",
    code: certificate.certificateCode,
    studentName: certificate.student.user.name,
    courseTitle: certificate.course.title,
    issuedAt: certificate.issuedAt,
    revokedAt: certificate.revokedAt,
  };
}

/**
 * The public origin used in QR codes. Prefers the configured app URL so a
 * spoofed Host header can't change where a printed QR points.
 */
export function publicAppOrigin(fallbackOrigin?: string): string {
  const configured = process.env.APP_BASE_URL ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  const origin = configured || fallbackOrigin || "http://localhost:3000";
  return new URL(origin).origin;
}

export function certificateVerificationUrl(code: string, fallbackOrigin?: string): string {
  return `${publicAppOrigin(fallbackOrigin)}/certificates/verify/${encodeURIComponent(code)}`;
}

/**
 * A real QR code (SVG markup), generated locally by the `qrcode` library —
 * no external QR service is called. It encodes only the public
 * verification URL (no ids, no tokens, no personal data).
 */
export async function certificateQrSvg(verificationUrl: string): Promise<string> {
  return QRCode.toString(verificationUrl, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}

// ---------------------------------------------------------------------------
// Revocation (teacher/admin only)
// ---------------------------------------------------------------------------

export async function revokeCertificate(
  prisma: PrismaClient,
  params: { certificateId: string; actorUserId: string; reason: string },
) {
  const reason = params.reason.trim().slice(0, 300);
  if (!reason) throw new Error("الرجاء كتابة سبب الإلغاء");
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.certificate.updateMany({
      where: { id: params.certificateId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (count === 0) throw new Error("الشهادة غير موجودة أو ملغاة بالفعل");
    await tx.auditLog.create({
      data: {
        actorId: params.actorUserId,
        action: "REVOKE_CERTIFICATE",
        entityType: "Certificate",
        entityId: params.certificateId,
        metadata: { reason },
      },
    });
  });
}

export async function restoreCertificate(
  prisma: PrismaClient,
  params: { certificateId: string; actorUserId: string },
) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.certificate.updateMany({
      where: { id: params.certificateId, revokedAt: { not: null } },
      data: { revokedAt: null, revokedReason: null },
    });
    if (count === 0) throw new Error("الشهادة غير موجودة أو غير ملغاة");
    await tx.auditLog.create({
      data: {
        actorId: params.actorUserId,
        action: "RESTORE_CERTIFICATE",
        entityType: "Certificate",
        entityId: params.certificateId,
      },
    });
  });
}
