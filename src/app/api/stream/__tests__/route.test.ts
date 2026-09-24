import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDatabase } from "@/test/reset-db";
import { createLesson, createStudent, createVideo } from "@/test/factories";
import { sessionCookieFor } from "@/test/session";
import { issuePlaybackToken } from "@/lib/business/playback";
import { getVideoStorageProvider } from "@/lib/storage/provider";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/stream/[videoId]/route";

beforeEach(async () => {
  await resetDatabase();
});

function makeExp() {
  return Math.floor(Date.now() / 1000) + 60;
}

async function studentUserOf(student: { userId: string }) {
  return prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
}

describe("GET /api/stream/[videoId]", () => {
  it("streams the full file with a valid token and a matching session", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ isFree: true });
    const video = await createVideo({ lessonId: lesson.id, isFree: true });

    const content = Buffer.from("fake mp4 bytes for testing purposes");
    await getVideoStorageProvider().save(video.storageKey, content);

    const token = issuePlaybackToken({ studentId: student.id, videoId: video.id, exp: makeExp() });
    const user = await studentUserOf(student);
    const cookie = await sessionCookieFor({
      id: user.id,
      role: user.role,
      studentProfileId: student.id,
    });
    const request = new NextRequest(
      `http://localhost/api/stream/${video.id}?token=${token}`,
      { headers: { cookie } },
    );

    const response = await GET(request, { params: Promise.resolve({ videoId: video.id }) });
    expect(response!.status).toBe(200);
    const body = Buffer.from(await response!.arrayBuffer());
    expect(body.equals(content)).toBe(true);
  });

  it("serves a byte range with 206 Partial Content", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ isFree: true });
    const video = await createVideo({ lessonId: lesson.id, isFree: true });

    const content = Buffer.from("0123456789ABCDEF");
    await getVideoStorageProvider().save(video.storageKey, content);

    const token = issuePlaybackToken({ studentId: student.id, videoId: video.id, exp: makeExp() });
    const user = await studentUserOf(student);
    const cookie = await sessionCookieFor({
      id: user.id,
      role: user.role,
      studentProfileId: student.id,
    });
    const request = new NextRequest(
      `http://localhost/api/stream/${video.id}?token=${token}`,
      { headers: { range: "bytes=2-5", cookie } },
    );

    const response = await GET(request, { params: Promise.resolve({ videoId: video.id }) });
    expect(response!.status).toBe(206);
    expect(response!.headers.get("content-range")).toBe(`bytes 2-5/${content.length}`);
    const body = Buffer.from(await response!.arrayBuffer());
    expect(body.toString()).toBe("2345");
  });

  it("rejects a missing token", async () => {
    const lesson = await createLesson({ isFree: true });
    const video = await createVideo({ lessonId: lesson.id, isFree: true });
    const request = new NextRequest(`http://localhost/api/stream/${video.id}`);

    const response = await GET(request, { params: Promise.resolve({ videoId: video.id }) });
    expect(response!.status).toBe(401);
  });

  it("rejects a token whose video no longer matches (id substitution)", async () => {
    const student = await createStudent();
    const lessonA = await createLesson({ isFree: true });
    const videoA = await createVideo({ lessonId: lessonA.id, isFree: true });
    const lessonB = await createLesson({ isFree: true });
    const videoB = await createVideo({ lessonId: lessonB.id, isFree: true });
    await getVideoStorageProvider().save(videoB.storageKey, Buffer.from("secret content"));

    // Token was issued for videoA but the request is for videoB.
    const token = issuePlaybackToken({ studentId: student.id, videoId: videoA.id, exp: makeExp() });
    const request = new NextRequest(`http://localhost/api/stream/${videoB.id}?token=${token}`);

    const response = await GET(request, { params: Promise.resolve({ videoId: videoB.id }) });
    expect(response!.status).toBe(401);
  });

  it("re-checks entitlement at stream time, denying a video the student is not entitled to", async () => {
    const student = await createStudent();
    const lesson = await createLesson(); // paid, no entitlement granted
    const video = await createVideo({ lessonId: lesson.id });
    await getVideoStorageProvider().save(video.storageKey, Buffer.from("paid content"));

    const token = issuePlaybackToken({ studentId: student.id, videoId: video.id, exp: makeExp() });
    const user = await studentUserOf(student);
    const cookie = await sessionCookieFor({
      id: user.id,
      role: user.role,
      studentProfileId: student.id,
    });
    const request = new NextRequest(`http://localhost/api/stream/${video.id}?token=${token}`, {
      headers: { cookie },
    });

    const response = await GET(request, { params: Promise.resolve({ videoId: video.id }) });
    expect(response!.status).toBe(403);
  });

  // Regression coverage for the real gap found in the final audit: a copied
  // signed URL used to work for any bearer — logged out entirely, or logged
  // in as someone else — for the token's full 4-hour lifetime, because the
  // "token must match the current session" check only ran when a session
  // cookie happened to be present at all.
  describe("session binding (final audit gap #2)", () => {
    it("rejects a valid, unexpired token when there is no session cookie at all", async () => {
      const student = await createStudent();
      const lesson = await createLesson({ isFree: true });
      const video = await createVideo({ lessonId: lesson.id, isFree: true });
      await getVideoStorageProvider().save(video.storageKey, Buffer.from("content"));

      const token = issuePlaybackToken({ studentId: student.id, videoId: video.id, exp: makeExp() });
      const request = new NextRequest(`http://localhost/api/stream/${video.id}?token=${token}`);

      const response = await GET(request, { params: Promise.resolve({ videoId: video.id }) });
      expect(response!.status).toBe(403);
    });

    it("rejects a valid token when the session belongs to a different student", async () => {
      const student = await createStudent();
      const otherStudent = await createStudent();
      const lesson = await createLesson({ isFree: true });
      const video = await createVideo({ lessonId: lesson.id, isFree: true });
      await getVideoStorageProvider().save(video.storageKey, Buffer.from("content"));

      const token = issuePlaybackToken({ studentId: student.id, videoId: video.id, exp: makeExp() });
      const otherUser = await studentUserOf(otherStudent);
      const cookie = await sessionCookieFor({
        id: otherUser.id,
        role: otherUser.role,
        studentProfileId: otherStudent.id,
      });
      const request = new NextRequest(`http://localhost/api/stream/${video.id}?token=${token}`, {
        headers: { cookie },
      });

      const response = await GET(request, { params: Promise.resolve({ videoId: video.id }) });
      expect(response!.status).toBe(403);
    });

    it("rejects a valid token whose owning student account was blocked mid-window", async () => {
      const student = await createStudent();
      const lesson = await createLesson({ isFree: true });
      const video = await createVideo({ lessonId: lesson.id, isFree: true });
      await getVideoStorageProvider().save(video.storageKey, Buffer.from("content"));

      const user = await studentUserOf(student);
      const cookie = await sessionCookieFor({
        id: user.id,
        role: user.role,
        studentProfileId: student.id,
      });
      await prisma.user.update({ where: { id: user.id }, data: { status: "BLOCKED" } });

      const token = issuePlaybackToken({ studentId: student.id, videoId: video.id, exp: makeExp() });
      const request = new NextRequest(`http://localhost/api/stream/${video.id}?token=${token}`, {
        headers: { cookie },
      });

      const response = await GET(request, { params: Promise.resolve({ videoId: video.id }) });
      expect(response!.status).toBe(403);
    });
  });
});
