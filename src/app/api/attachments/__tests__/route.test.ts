import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDatabase } from "@/test/reset-db";
import {
  createCourse,
  createEntitlement,
  createLesson,
  createParent,
  createStudent,
  createTeacher,
} from "@/test/factories";
import { sessionCookieFor } from "@/test/session";
import {
  issueAttachmentToken,
  listLessonAttachmentsForStudent,
  newAttachmentStorageKey,
} from "@/lib/business/attachments";
import { issuePlaybackToken } from "@/lib/business/playback";
import { getAttachmentStorageProvider } from "@/lib/storage/provider";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/attachments/[attachmentId]/route";

beforeEach(async () => {
  await resetDatabase();
});

const PDF = Buffer.from("%PDF-1.4\n% test file\n");

async function attachmentFor(lessonId: string, name = "ملخص الدرس.pdf") {
  const storageKey = newAttachmentStorageKey("pdf");
  await getAttachmentStorageProvider().save(storageKey, PDF);
  return prisma.attachment.create({
    data: {
      lessonId,
      storageKey,
      originalName: name,
      mimeType: "application/pdf",
      fileType: "PDF",
      sizeBytes: PDF.length,
    },
  });
}

async function cookieForStudent(student: { id: string; userId: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
  return sessionCookieFor({ id: user.id, role: user.role, studentProfileId: student.id });
}

async function get(attachmentId: string, opts: { token?: string; cookie?: string } = {}) {
  const url = `http://localhost/api/attachments/${attachmentId}${opts.token ? `?token=${opts.token}` : ""}`;
  const request = new NextRequest(url, { headers: opts.cookie ? { cookie: opts.cookie } : {} });
  return (await GET(request, { params: Promise.resolve({ attachmentId }) }))!;
}

/** An entitled student, their lesson with one PDF, and a signed URL for it. */
async function setup() {
  const student = await createStudent();
  const lesson = await createLesson();
  await createEntitlement({ studentId: student.id, lessonId: lesson.id });
  const attachment = await attachmentFor(lesson.id);
  const token = issueAttachmentToken({ studentId: student.id, attachmentId: attachment.id });
  const cookie = await cookieForStudent(student);
  return { student, lesson, attachment, token, cookie };
}

describe("GET /api/attachments/[attachmentId]", () => {
  it("downloads with a valid token and the matching session, as a safe attachment", async () => {
    const { attachment, token, cookie } = await setup();
    const response = await get(attachment.id, { token, cookie });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(PDF)).toBe(true);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(response.headers.get("content-disposition")).toContain(encodeURIComponent("ملخص الدرس.pdf"));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects a request with no session", async () => {
    const { attachment, token } = await setup();
    expect((await get(attachment.id, { token })).status).toBe(401);
  });

  it("rejects a student with no token", async () => {
    const { attachment, cookie } = await setup();
    expect((await get(attachment.id, { cookie })).status).toBe(401);
  });

  it("rejects a tampered token", async () => {
    const { attachment, token, cookie } = await setup();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), exp: 9999999999 }),
    ).toString("base64url");
    expect((await get(attachment.id, { token: `${forged}.${sig}`, cookie })).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const { student, attachment, cookie } = await setup();
    const old = issueAttachmentToken({
      studentId: student.id,
      attachmentId: attachment.id,
      now: new Date(Date.now() - 60 * 60_000),
    });
    expect((await get(attachment.id, { token: old, cookie })).status).toBe(401);
  });

  it("a token for one attachment cannot open another lesson's attachment by changing the id", async () => {
    const { token, cookie } = await setup();
    const otherLesson = await createLesson();
    const other = await attachmentFor(otherLesson.id);
    expect((await get(other.id, { token, cookie })).status).toBe(401);
  });

  it("a video playback token is not accepted as an attachment token", async () => {
    const { student, attachment, cookie } = await setup();
    const videoToken = issuePlaybackToken({
      studentId: student.id,
      videoId: attachment.id,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect((await get(attachment.id, { token: videoToken, cookie })).status).toBe(401);
  });

  it("another student cannot use a copied link", async () => {
    const { lesson, attachment, token } = await setup();
    const other = await createStudent();
    await createEntitlement({ studentId: other.id, lessonId: lesson.id });
    expect((await get(attachment.id, { token, cookie: await cookieForStudent(other) })).status).toBe(403);
  });

  it("stops working once the entitlement is revoked", async () => {
    const { student, attachment, token, cookie } = await setup();
    await prisma.entitlement.updateMany({ where: { studentId: student.id }, data: { revokedAt: new Date() } });
    expect((await get(attachment.id, { token, cookie })).status).toBe(403);
  });

  it("stops working once the lesson or course is unpublished", async () => {
    const { lesson, attachment, token, cookie } = await setup();
    await prisma.course.update({ where: { id: lesson.courseId }, data: { status: "DRAFT" } });
    expect((await get(attachment.id, { token, cookie })).status).toBe(403);
  });

  it("keeps working for an existing entitlement holder after archiving", async () => {
    const { lesson, attachment, token, cookie } = await setup();
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: "ARCHIVED" } });
    expect((await get(attachment.id, { token, cookie })).status).toBe(200);
  });

  it("a parent is refused", async () => {
    const { attachment, token } = await setup();
    const parent = await createParent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: parent.userId } });
    const cookie = await sessionCookieFor({ id: user.id, role: user.role, parentProfileId: parent.id });
    expect((await get(attachment.id, { token, cookie })).status).toBe(403);
  });

  it("a teacher can download with their session", async () => {
    const { attachment } = await setup();
    const teacher = await createTeacher();
    const cookie = await sessionCookieFor({ id: teacher.id, role: teacher.role });
    const response = await get(attachment.id, { cookie });
    expect(response.status).toBe(200);
  });

  it("returns 404 for an unknown id (teacher)", async () => {
    const teacher = await createTeacher();
    const cookie = await sessionCookieFor({ id: teacher.id, role: teacher.role });
    expect((await get("does-not-exist", { cookie })).status).toBe(404);
  });
});

describe("listLessonAttachmentsForStudent", () => {
  it("lists signed links only for a lesson the student can use", async () => {
    const { student, lesson, attachment } = await setup();
    const list = await listLessonAttachmentsForStudent(prisma, { studentId: student.id, lessonId: lesson.id });
    expect(list).toHaveLength(1);
    expect(list[0].url).toMatch(new RegExp(`^/api/attachments/${attachment.id}\\?token=`));
    expect(JSON.stringify(list)).not.toContain(attachment.storageKey);

    const stranger = await createStudent();
    expect(await listLessonAttachmentsForStudent(prisma, { studentId: stranger.id, lessonId: lesson.id })).toEqual([]);
  });

  it("lists nothing for a draft course even with an entitlement", async () => {
    const student = await createStudent();
    const course = await createCourse({ status: "DRAFT" });
    const lesson = await createLesson({ courseId: course.id });
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    await attachmentFor(lesson.id);
    expect(await listLessonAttachmentsForStudent(prisma, { studentId: student.id, lessonId: lesson.id })).toEqual([]);
  });

  it("lists nothing when the prerequisite lesson is not done", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const first = await createLesson({ courseId: course.id });
    const second = await createLesson({ courseId: course.id, requiredPreviousLessonId: first.id });
    await createEntitlement({ studentId: student.id, lessonId: second.id });
    await attachmentFor(second.id);
    expect(await listLessonAttachmentsForStudent(prisma, { studentId: student.id, lessonId: second.id })).toEqual([]);
  });
});
