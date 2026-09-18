import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCourse, createLesson, createStudent, createVideo } from "@/test/factories";
import {
  issuePlaybackToken,
  issueSignedPlaybackUrl,
  verifyPlaybackToken,
} from "@/lib/business/playback";

beforeEach(async () => {
  await resetDatabase();
});

describe("playback token signing", () => {
  it("verifies a token it just issued", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = issuePlaybackToken({ studentId: "s1", videoId: "v1", exp });
    const payload = verifyPlaybackToken(token);
    expect(payload).toEqual({ studentId: "s1", videoId: "v1", exp });
  });

  it("rejects a tampered payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = issuePlaybackToken({ studentId: "s1", videoId: "v1", exp });
    const [payload, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ studentId: "attacker", videoId: "v1", exp }),
    ).toString("base64url");
    expect(verifyPlaybackToken(`${tamperedPayload}.${signature}`)).toBeNull();
    void payload;
  });

  it("rejects an expired token", () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const token = issuePlaybackToken({ studentId: "s1", videoId: "v1", exp });
    expect(verifyPlaybackToken(token)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyPlaybackToken("not-a-real-token")).toBeNull();
    expect(verifyPlaybackToken("")).toBeNull();
  });
});

describe("issueSignedPlaybackUrl", () => {
  it("issues a URL for an entitled student and denies a non-entitled one", async () => {
    const student = await createStudent();
    const outsider = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id, isFree: true });
    const video = await createVideo({ lessonId: lesson.id, isFree: true });

    const allowed = await issueSignedPlaybackUrl(prisma, {
      studentId: student.id,
      videoId: video.id,
    });
    expect("url" in allowed).toBe(true);
    if ("url" in allowed) {
      expect(allowed.url).toContain(`/api/stream/${video.id}?token=`);
    }

    const paidLesson = await createLesson({ courseId: course.id });
    const paidVideo = await createVideo({ lessonId: paidLesson.id });
    const denied = await issueSignedPlaybackUrl(prisma, {
      studentId: outsider.id,
      videoId: paidVideo.id,
    });
    expect(denied).toEqual({ error: "NOT_ENTITLED" });
  });
});
