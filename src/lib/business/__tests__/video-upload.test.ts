import { beforeEach, describe, expect, it } from "vitest";
import { detectVideoContainer, replaceLessonVideoFile, validateVideoUpload } from "@/lib/business/video-upload";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createLesson, createVideo } from "@/test/factories";

const ftyp = (brand: string) => Uint8Array.from([0, 0, 0, 0x20, ...Buffer.from("ftyp"), ...Buffer.from(brand), 0, 0, 0, 0]);
const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const html = Uint8Array.from(Buffer.from("<html><script>alert(1)</script></html>"));
const MB = 1024 * 1024;

describe("video upload validation", () => {
  it("detects containers from the bytes", () => {
    expect(detectVideoContainer(ftyp("isom"))).toBe(".mp4");
    expect(detectVideoContainer(ftyp("mp42"))).toBe(".mp4");
    expect(detectVideoContainer(ftyp("qt  "))).toBe(".mov");
    expect(detectVideoContainer(webm)).toBe(".webm");
    expect(detectVideoContainer(html)).toBeNull();
    expect(detectVideoContainer(new Uint8Array())).toBeNull();
  });

  it("stores under the detected extension, not the client's filename", () => {
    expect(validateVideoUpload({ type: "video/mp4", size: 10, bytes: ftyp("isom") }, MB, "1MB")).toBe(".mp4");
    expect(validateVideoUpload({ type: "video/quicktime", size: 10, bytes: ftyp("qt  ") }, MB, "1MB")).toBe(".mov");
    expect(validateVideoUpload({ type: "video/webm", size: 10, bytes: webm }, MB, "1MB")).toBe(".webm");
  });

  it("rejects a renamed non-video file, a wrong declared type, oversize and empty files", () => {
    expect(() => validateVideoUpload({ type: "video/mp4", size: 10, bytes: html }, MB, "1MB")).toThrow(/ليس فيديو/);
    expect(() => validateVideoUpload({ type: "text/html", size: 10, bytes: ftyp("isom") }, MB, "1MB")).toThrow(/غير مدعومة/);
    expect(() => validateVideoUpload({ type: "video/webm", size: 10, bytes: ftyp("isom") }, MB, "1MB")).toThrow(/لا يطابق/);
    expect(() => validateVideoUpload({ type: "video/mp4", size: 2 * MB, bytes: ftyp("isom") }, MB, "1MB")).toThrow(/الحد المسموح/);
    expect(() => validateVideoUpload({ type: "video/mp4", size: 0, bytes: new Uint8Array() }, MB, "1MB")).toThrow();
  });
});

describe("replaceLessonVideoFile", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const file = (storageKey: string) => ({ storageProvider: "LOCAL_PRIVATE", storageKey, title: storageKey, durationSeconds: 60, isFree: false });

  it("keeps the video's id and status and returns the key it replaced", async () => {
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });
    await prisma.video.update({ where: { id: video.id }, data: { status: "ARCHIVED" } });

    const replaced = await replaceLessonVideoFile(prisma, { lessonId: lesson.id, ...file("new.mp4") });

    expect(replaced).toBe(video.storageKey);
    const after = await prisma.video.findUniqueOrThrow({ where: { lessonId: lesson.id } });
    expect(after).toMatchObject({ id: video.id, storageKey: "new.mp4", status: "ARCHIVED" });
  });

  it("regression: parallel replacements each return the key they replaced, so no file is orphaned", async () => {
    // Before the fix, each upload read the current key before any of them
    // wrote, so all deleted the same old file and every intermediate new
    // file was left unreferenced (seen in the real-upload E2E run).
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });
    const keys = Array.from({ length: 6 }, (_, i) => `k${i}.mp4`);

    const replaced = await Promise.all(keys.map((k) => replaceLessonVideoFile(prisma, { lessonId: lesson.id, ...file(k) })));

    const finalKey = (await prisma.video.findUniqueOrThrow({ where: { lessonId: lesson.id } })).storageKey;
    // Every key but the final one is replaced exactly once: deleting the
    // returned keys leaves exactly the referenced file.
    expect([...replaced].sort()).toEqual([video.storageKey, ...keys.filter((k) => k !== finalKey)].sort());
  });

  it("parallel first uploads to a lesson without a video create one row, not a conflict", async () => {
    const lesson = await createLesson();
    const replaced = await Promise.all(["a.mp4", "b.mp4", "c.mp4"].map((k) => replaceLessonVideoFile(prisma, { lessonId: lesson.id, ...file(k) })));
    expect(await prisma.video.count({ where: { lessonId: lesson.id } })).toBe(1);
    expect(replaced.filter((k) => k === null)).toHaveLength(1);
  });
});
