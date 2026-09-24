import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

/**
 * Storage-provider abstraction so a real object-storage service (S3,
 * Cloudflare R2/Stream, Mux, ...) can replace the local-disk implementation
 * below without touching any of the playback/authorization code that
 * depends on this interface. Nothing here is served through Next's public
 * static file handler — files live outside `public/` and are only ever
 * reachable through the authenticated, entitlement-checked streaming route
 * (see src/app/api/stream/[videoId]/route.ts).
 */
export interface StorageProvider {
  readonly name: string;
  save(key: string, data: Buffer): Promise<void>;
  getSize(key: string): Promise<number>;
  /** Range is inclusive, byte offsets, matching HTTP Range semantics. */
  readStream(key: string, range?: { start: number; end: number }): Readable;
  delete(key: string): Promise<void>;
  generateKey(originalFilename: string): string;
}

const VIDEO_STORAGE_ROOT = path.join(process.cwd(), "storage", "videos");
const ATTACHMENT_STORAGE_ROOT = path.join(process.cwd(), "storage", "attachments");

class LocalPrivateStorageProvider implements StorageProvider {
  readonly name = "LOCAL_PRIVATE";

  constructor(private readonly root: string) {}

  private resolvePath(key: string): string {
    // Reject any path traversal attempt — key must be a bare filename.
    if (key.includes("..") || key.includes("/") || key.includes("\\") || key.includes("\0")) {
      throw new Error("Invalid storage key");
    }
    const resolved = path.resolve(this.root, key);
    if (path.dirname(resolved) !== path.resolve(this.root)) throw new Error("Invalid storage key");
    return resolved;
  }

  async save(key: string, data: Buffer): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true });
    await fsp.writeFile(this.resolvePath(key), data);
  }

  async getSize(key: string): Promise<number> {
    const stat = await fsp.stat(this.resolvePath(key));
    return stat.size;
  }

  readStream(key: string, range?: { start: number; end: number }): Readable {
    const filePath = this.resolvePath(key);
    return range
      ? fs.createReadStream(filePath, { start: range.start, end: range.end })
      : fs.createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.resolvePath(key), { force: true });
  }

  generateKey(originalFilename: string): string {
    const ext = path.extname(originalFilename) || ".mp4";
    return `${randomUUID()}${ext}`;
  }
}

const localPrivateStorageProvider = new LocalPrivateStorageProvider(VIDEO_STORAGE_ROOT);
const attachmentStorageProvider = new LocalPrivateStorageProvider(ATTACHMENT_STORAGE_ROOT);

/**
 * A concrete cloud provider (S3, R2, Mux, Cloudflare Stream, ...) is not
 * configured in this environment. Swapping one in means implementing
 * StorageProvider against its SDK and returning it here — every caller
 * (upload actions, the streaming route) only depends on this interface.
 */
export function getVideoStorageProvider(): StorageProvider {
  return localPrivateStorageProvider;
}

/** Lesson attachments: same private-disk model, separate root from videos. */
export function getAttachmentStorageProvider(): StorageProvider {
  return attachmentStorageProvider;
}
