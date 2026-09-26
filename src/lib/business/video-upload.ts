/**
 * Server-side check of an uploaded video: the browser-declared type must be
 * an allowed one AND the bytes must start like a real MP4/QuickTime (ISO
 * base media "ftyp" box) or WebM (EBML header) file. The stored file's
 * extension comes from what was detected, never from the client's
 * filename, so a renamed HTML/script file can't be stored as-is.
 */
export const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export function detectVideoContainer(bytes: Uint8Array): ".mp4" | ".mov" | ".webm" | null {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    return brand === "qt  " ? ".mov" : ".mp4";
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return ".webm";
  }
  return null;
}

/** Returns the extension to store the file under, or throws an Arabic message. */
export function validateVideoUpload(file: { type: string; size: number; bytes: Uint8Array }, maxBytes: number, maxLabel: string): string {
  if (file.size === 0) throw new Error("الرجاء اختيار ملف فيديو");
  if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
    throw new Error("صيغة الفيديو غير مدعومة (MP4 أو WebM أو MOV فقط)");
  }
  if (file.size > maxBytes) {
    throw new Error(`حجم الفيديو أكبر من الحد المسموح (${maxLabel})`);
  }
  const ext = detectVideoContainer(file.bytes);
  if (!ext) throw new Error("محتوى الملف ليس فيديو MP4 أو WebM أو MOV صالحًا");
  const declaredWebm = file.type === "video/webm";
  if (declaredWebm !== (ext === ".webm")) {
    throw new Error("نوع الملف المعلن لا يطابق محتواه");
  }
  return ext;
}
