import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { assertStudentCanUseLesson } from "@/lib/business/content-visibility";

/**
 * Lesson attachments (PDF / image / Office documents).
 *
 * - Files are stored in private storage under a server-generated key; the
 *   uploaded filename is kept only as display metadata and never touches
 *   the filesystem path.
 * - The type is detected from the file's magic bytes and must agree with its
 *   extension — the browser-supplied MIME type is ignored.
 * - A student downloads through /api/attachments/[id]?token=… where the
 *   token is short-lived, HMAC-signed, scoped to "attachment" and bound to
 *   both the student and this exact attachment. The route additionally
 *   re-derives the lesson from the database and re-runs the lesson access
 *   check on every request, so neither an old token nor an edited id grants
 *   anything the student can't currently open.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const TOKEN_TTL_SECONDS = 10 * 60;

type Detected = { ext: string; mimeType: string; fileType: "PDF" | "IMAGE" | "DOCUMENT" };

const TYPES: Record<string, Detected & { magic: number[] }> = {
  pdf: { ext: "pdf", mimeType: "application/pdf", fileType: "PDF", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  png: { ext: "png", mimeType: "image/png", fileType: "IMAGE", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  jpg: { ext: "jpg", mimeType: "image/jpeg", fileType: "IMAGE", magic: [0xff, 0xd8, 0xff] },
  jpeg: { ext: "jpg", mimeType: "image/jpeg", fileType: "IMAGE", magic: [0xff, 0xd8, 0xff] },
  docx: {
    ext: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileType: "DOCUMENT",
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  pptx: {
    ext: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    fileType: "DOCUMENT",
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
};

export const ACCEPTED_ATTACHMENT_EXTENSIONS = ".pdf,.png,.jpg,.jpeg,.docx,.pptx";

/** Validates an uploaded file; throws an Arabic message on rejection. */
export function validateAttachmentFile(file: { name: string; bytes: Buffer }): Detected & { originalName: string } {
  if (file.bytes.length === 0) throw new Error("الملف فارغ");
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("حجم الملف يتجاوز 25 ميجابايت");

  // Display name only: strip any directory part and control characters.
  const originalName = (file.name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  const dot = originalName.lastIndexOf(".");
  const extension = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "";
  const type = Object.hasOwn(TYPES, extension) ? TYPES[extension] : null;
  if (!originalName || !type) {
    throw new Error("نوع الملف غير مسموح — المسموح: PDF، PNG، JPG، DOCX، PPTX");
  }
  if (!type.magic.every((byte, i) => file.bytes[i] === byte)) {
    throw new Error("محتوى الملف لا يطابق امتداده");
  }
  return { ext: type.ext, mimeType: type.mimeType, fileType: type.fileType, originalName };
}

export function newAttachmentStorageKey(ext: string): string {
  return `${randomUUID()}.${ext}`;
}

// ---------------------------------------------------------------------------
// Signed download tokens
// ---------------------------------------------------------------------------

type TokenPayload = { p: "attachment"; sub: string; aid: string; exp: number };

function sign(data: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return createHmac("sha256", secret).update(`attachment:${data}`).digest("base64url");
}

export function issueAttachmentToken(params: { studentId: string; attachmentId: string; now?: Date }): string {
  const exp = Math.floor((params.now ?? new Date()).getTime() / 1000) + TOKEN_TTL_SECONDS;
  const payload: TokenPayload = { p: "attachment", sub: params.studentId, aid: params.attachmentId, exp };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyAttachmentToken(token: string, now = new Date()): TokenPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = Buffer.from(sign(encoded));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as TokenPayload;
    if (payload.p !== "attachment" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(now.getTime() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Student listing + download authorization
// ---------------------------------------------------------------------------

async function studentMayUseLesson(prisma: PrismaClient, studentId: string, lessonId: string) {
  try {
    await assertStudentCanUseLesson(prisma, { studentId, lessonId });
    return true;
  } catch {
    return false;
  }
}

/**
 * The lesson's attachments with fresh signed download URLs — or nothing at
 * all when the student can't use the lesson (not entitled, unpublished,
 * prerequisite not met).
 */
export async function listLessonAttachmentsForStudent(
  prisma: PrismaClient,
  params: { studentId: string; lessonId: string },
) {
  if (!(await studentMayUseLesson(prisma, params.studentId, params.lessonId))) return [];
  const attachments = await prisma.attachment.findMany({
    where: { lessonId: params.lessonId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, originalName: true, fileType: true, sizeBytes: true },
  });
  return attachments.map((a) => ({
    ...a,
    url: `/api/attachments/${a.id}?token=${issueAttachmentToken({ studentId: params.studentId, attachmentId: a.id })}`,
  }));
}

export type DownloadDecision =
  | { ok: true; attachment: { storageKey: string; mimeType: string; originalName: string; sizeBytes: number } }
  | { ok: false; status: 401 | 403 | 404; message: string };

/**
 * Decides one download request. Teachers (TEACHER_ADMIN) may fetch any
 * attachment with their session. Students need a valid token for THIS
 * attachment, issued to THEM (matching the live session), plus current
 * access to the attachment's lesson as recorded in the database.
 */
export async function authorizeAttachmentDownload(
  prisma: PrismaClient,
  params: {
    attachmentId: string;
    token: string | null;
    session: { role?: string; studentProfileId?: string | null } | null | undefined;
    now?: Date;
  },
): Promise<DownloadDecision> {
  const { session } = params;
  if (!session?.role) return { ok: false, status: 401, message: "Sign in required" };

  const attachment = await prisma.attachment.findUnique({
    where: { id: params.attachmentId },
    select: { lessonId: true, storageKey: true, mimeType: true, originalName: true, sizeBytes: true },
  });

  if (session.role === "TEACHER_ADMIN") {
    return attachment ? { ok: true, attachment } : { ok: false, status: 404, message: "Not found" };
  }
  if (session.role !== "STUDENT" || !session.studentProfileId) {
    return { ok: false, status: 403, message: "Forbidden" };
  }

  if (!params.token) return { ok: false, status: 401, message: "Missing download token" };
  const payload = verifyAttachmentToken(params.token, params.now);
  if (!payload || payload.aid !== params.attachmentId) {
    return { ok: false, status: 401, message: "Invalid or expired download token" };
  }
  if (payload.sub !== session.studentProfileId) {
    return { ok: false, status: 403, message: "Token does not match the current session" };
  }
  if (!attachment) return { ok: false, status: 404, message: "Not found" };
  if (!(await studentMayUseLesson(prisma, session.studentProfileId, attachment.lessonId))) {
    return { ok: false, status: 403, message: "Access no longer authorized" };
  }
  return { ok: true, attachment };
}

/** RFC 6266 / 5987 Content-Disposition that is safe for any filename. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
