import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  contentDisposition,
  newAttachmentStorageKey,
  validateAttachmentFile,
} from "@/lib/business/attachments";
import { getAttachmentStorageProvider } from "@/lib/storage/provider";

const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

describe("validateAttachmentFile", () => {
  it("accepts real PDFs, images and Office files", () => {
    expect(validateAttachmentFile({ name: "notes.pdf", bytes: PDF }).mimeType).toBe("application/pdf");
    expect(validateAttachmentFile({ name: "Diagram.PNG", bytes: PNG }).fileType).toBe("IMAGE");
    expect(validateAttachmentFile({ name: "slides.pptx", bytes: ZIP }).fileType).toBe("DOCUMENT");
  });

  it("rejects disallowed extensions, even with PDF content", () => {
    for (const name of ["x.html", "x.svg", "x.exe", "x.js", "x", "x.pdf.html", ".pdf"]) {
      expect(() => validateAttachmentFile({ name, bytes: PDF })).toThrow();
    }
  });

  it("rejects content that does not match the extension", () => {
    expect(() => validateAttachmentFile({ name: "fake.pdf", bytes: Buffer.from("<html><script>") })).toThrow(
      "لا يطابق",
    );
    expect(() => validateAttachmentFile({ name: "fake.png", bytes: PDF })).toThrow();
  });

  it("rejects empty and oversized files", () => {
    expect(() => validateAttachmentFile({ name: "a.pdf", bytes: Buffer.alloc(0) })).toThrow();
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
    PDF.copy(big);
    expect(() => validateAttachmentFile({ name: "a.pdf", bytes: big })).toThrow();
  });

  it("keeps only a display name — directory parts and control characters are stripped", () => {
    expect(validateAttachmentFile({ name: "../../etc/passwd.pdf", bytes: PDF }).originalName).toBe("passwd.pdf");
    expect(validateAttachmentFile({ name: "..\\..\\win.pdf", bytes: PDF }).originalName).toBe("win.pdf");
    expect(validateAttachmentFile({ name: "a\r\nb.pdf", bytes: PDF }).originalName).toBe("ab.pdf");
  });
});

describe("storage keys and paths", () => {
  it("generates opaque keys that never include the uploaded name", () => {
    expect(newAttachmentStorageKey("pdf")).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });

  it("refuses traversal keys", async () => {
    const storage = getAttachmentStorageProvider();
    for (const key of ["../x", "..", "a/b", "a\\b", "x\0y", "/etc/passwd"]) {
      await expect(storage.getSize(key)).rejects.toThrow("Invalid storage key");
    }
  });
});

describe("contentDisposition", () => {
  it("cannot be used for header injection", () => {
    const header = contentDisposition('evil"; filename="x.html');
    expect(header).toMatch(/^attachment; filename="evil_; filename=_x.html"; filename\*=UTF-8''/);
  });
});
