import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDatabase } from "@/test/reset-db";
import { createEntitlement, createLesson, createStudent, createVideo } from "@/test/factories";
import { sessionCookieFor } from "@/test/session";
import { issuePlaybackToken, issueSignedPlaybackUrl } from "@/lib/business/playback";
import {
  deliveredBuckets,
  recordDeliveredRange,
  startWatchSession,
  updateWatchProgress,
} from "@/lib/business/video-access";
import { getVideoStorageProvider } from "@/lib/storage/provider";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/stream/[videoId]/route";

beforeEach(async () => {
  await resetDatabase();
});

const FILE = Buffer.alloc(10_000, 7);

async function paidVideo(viewLimit = 3) {
  const student = await createStudent();
  const lesson = await createLesson();
  const video = await createVideo({ lessonId: lesson.id, viewLimit });
  await createEntitlement({ studentId: student.id, lessonId: lesson.id });
  await getVideoStorageProvider().save(video.storageKey, FILE);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
  const cookie = await sessionCookieFor({ id: user.id, role: user.role, studentProfileId: student.id });
  return { student, video, cookie };
}

async function stream(videoId: string, url: string, cookie: string, range?: string) {
  const headers: Record<string, string> = { cookie };
  if (range) headers.range = range;
  const res = (await GET(new NextRequest(`http://localhost${url}`, { headers }), {
    params: Promise.resolve({ videoId }),
  }))!;
  const body = res.status < 300 ? Buffer.from(await res.arrayBuffer()) : null;
  // Delivery accounting runs after the body finished; give it a tick.
  await new Promise((r) => setTimeout(r, 150));
  return { status: res.status, body };
}

const consumedViews = (studentId: string, videoId: string) =>
  prisma.watchSession.count({ where: { studentId, videoId, consumedView: true } });

describe("server-side view accounting on the stream route", () => {
  it("regression: streaming a paid video fully consumes a view even if the player never reports progress", async () => {
    const { student, video, cookie } = await paidVideo();
    const issued = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id });
    if ("error" in issued) throw new Error(issued.error);
    const res = await stream(video.id, issued.url, cookie);
    expect(res.status).toBe(200);
    expect(await consumedViews(student.id, video.id)).toBe(1);
  });

  it("regression: the view limit holds for a client that streams repeatedly without reporting progress", async () => {
    const { student, video, cookie } = await paidVideo(3);
    let fullPlays = 0;
    for (let i = 0; i < 6; i++) {
      const issued = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id });
      if ("error" in issued) {
        expect(issued.error).toBe("VIEW_LIMIT_REACHED");
        continue;
      }
      const res = await stream(video.id, issued.url, cookie);
      if (res.status === 200 && res.body?.length === FILE.length) fullPlays++;
    }
    expect(fullPlays).toBe(3);
    expect(await consumedViews(student.id, video.id)).toBe(3);
  });

  it("opening the player and receiving only the first part of the file consumes nothing", async () => {
    const { student, video, cookie } = await paidVideo();
    const issued = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id });
    if ("error" in issued) throw new Error(issued.error);
    const res = await stream(video.id, issued.url, cookie, "bytes=0-1999");
    expect(res.status).toBe(206);
    expect(await consumedViews(student.id, video.id)).toBe(0);
  });

  it("coverage accumulates across range requests (seeking) and repeated ranges are not double-counted", async () => {
    const { student, video, cookie } = await paidVideo();
    const issued = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id });
    if ("error" in issued) throw new Error(issued.error);
    for (let i = 0; i < 5; i++) await stream(video.id, issued.url, cookie, "bytes=0-3999");
    expect(await consumedViews(student.id, video.id)).toBe(0);
    await stream(video.id, issued.url, cookie, "bytes=4000-9999");
    expect(await consumedViews(student.id, video.id)).toBe(1);
  });

  it("regression: the session that consumed the last allowed view can finish; other sessions are refused", async () => {
    const { student, video, cookie } = await paidVideo(1);
    const issued = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id });
    if ("error" in issued) throw new Error(issued.error);
    await stream(video.id, issued.url, cookie, "bytes=0-8499"); // 85% → consumes view 1 of 1
    expect(await consumedViews(student.id, video.id)).toBe(1);
    // The rest of that same, paid view still plays…
    expect((await stream(video.id, issued.url, cookie, "bytes=8500-9999")).status).toBe(206);
    // …but a second session (e.g. an earlier-issued URL) is refused.
    const other = await startWatchSession(prisma, { studentId: student.id, videoId: video.id }).catch(() => null);
    expect(other).toBeNull();
    const stale = await prisma.watchSession.create({ data: { studentId: student.id, videoId: video.id } });
    const token = issuePlaybackToken({
      studentId: student.id,
      videoId: video.id,
      sessionId: stale.id,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect((await stream(video.id, `/api/stream/${video.id}?token=${token}`, cookie)).status).toBe(403);
  });

  it("rejects a token whose session belongs to another student or another video, and tokens without a session", async () => {
    const { student, video, cookie } = await paidVideo();
    const other = await paidVideo();
    const foreignSession = await prisma.watchSession.create({
      data: { studentId: other.student.id, videoId: other.video.id },
    });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const t1 = issuePlaybackToken({ studentId: student.id, videoId: video.id, sessionId: foreignSession.id, exp });
    expect((await stream(video.id, `/api/stream/${video.id}?token=${t1}`, cookie)).status).toBe(403);
    const legacy = issuePlaybackToken({ studentId: student.id, videoId: video.id, exp } as never);
    expect((await stream(video.id, `/api/stream/${video.id}?token=${legacy}`, cookie)).status).toBe(401);
  });

  it("free videos are never counted", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ isFree: true });
    const video = await createVideo({ lessonId: lesson.id, isFree: true, viewLimit: 1 });
    await getVideoStorageProvider().save(video.storageKey, FILE);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
    const cookie = await sessionCookieFor({ id: user.id, role: user.role, studentProfileId: student.id });
    for (let i = 0; i < 3; i++) {
      const issued = await issueSignedPlaybackUrl(prisma, { studentId: student.id, videoId: video.id });
      if ("error" in issued) throw new Error(issued.error);
      expect((await stream(video.id, issued.url, cookie)).status).toBe(200);
    }
    expect(await consumedViews(student.id, video.id)).toBe(0);
  });
});

describe("view consumption helpers", () => {
  it("counts only fully delivered 1% slices", () => {
    expect(deliveredBuckets({ fileSize: 1000, start: 0, bytes: 1000 })).toHaveLength(100);
    expect(deliveredBuckets({ fileSize: 1000, start: 0, bytes: 15 })).toEqual([0]);
    expect(deliveredBuckets({ fileSize: 1000, start: 5, bytes: 20 })).toEqual([1]);
    expect(deliveredBuckets({ fileSize: 1000, start: 0, bytes: 0 })).toEqual([]);
  });

  it("regression: an inflated client duration can't keep a fully watched session from counting", async () => {
    const { student, video } = await paidVideo();
    await prisma.video.update({ where: { id: video.id }, data: { durationSeconds: 100 } });
    const session = await startWatchSession(prisma, { studentId: student.id, videoId: video.id });
    const updated = await updateWatchProgress(prisma, {
      sessionId: session.id,
      watchedSeconds: 100,
      videoDurationSeconds: 1_000_000,
    });
    expect(updated.consumedView).toBe(true);
  });

  it("regression: sessions crossing the threshold at the same moment never exceed the limit", async () => {
    const { student, video } = await paidVideo(3);
    const sessions = await Promise.all(
      Array.from({ length: 8 }, () => prisma.watchSession.create({ data: { studentId: student.id, videoId: video.id } })),
    );
    await Promise.all(
      sessions.map((s, i) =>
        i % 2 === 0
          ? updateWatchProgress(prisma, { sessionId: s.id, watchedSeconds: 600, videoDurationSeconds: 600 })
          : recordDeliveredRange(prisma, { sessionId: s.id, fileSize: FILE.length, start: 0, bytes: FILE.length }),
      ),
    );
    expect(await consumedViews(student.id, video.id)).toBe(3);
    const numbers = (
      await prisma.watchSession.findMany({ where: { consumedView: true }, select: { viewNumber: true } })
    ).map((s) => s.viewNumber).sort();
    expect(numbers).toEqual([1, 2, 3]);
  });
});
