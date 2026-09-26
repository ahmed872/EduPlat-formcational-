import { describe, expect, it } from "vitest";
import { detectVideoContainer, validateVideoUpload } from "@/lib/business/video-upload";

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
