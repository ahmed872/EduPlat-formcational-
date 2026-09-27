import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getVideoStorageProvider } from "@/lib/storage/provider";

const storage = getVideoStorageProvider();
const root = path.join(process.env.STORAGE_ROOT || path.join(process.cwd(), "storage"), "videos");
const leftovers = (key: string) => fs.readdirSync(root).filter((f) => f.startsWith(key));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local private storage: save", () => {
  it("writes the exact bytes owner-only under the key, with no temporary file left", async () => {
    const key = storage.generateKey("clip.mp4");
    const data = Buffer.from("complete video bytes");
    await storage.save(key, data);
    const file = path.join(root, key);
    expect(fs.readFileSync(file).equals(data)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(leftovers(key)).toEqual([key]);
    await storage.delete(key);
  });

  it("regression: a write that fails midway leaves no file behind, partial or final", async () => {
    // Before the fix, save wrote straight to the final name, so a failed
    // write (disk full, process killed) left a truncated file there.
    const realWrite = fsp.writeFile;
    vi.spyOn(fsp, "writeFile").mockImplementation(async (target, data, options) => {
      await realWrite(target as string, (data as Buffer).subarray(0, 4), options as never);
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    });
    const key = storage.generateKey("clip.mp4");
    await expect(storage.save(key, Buffer.from("complete video bytes"))).rejects.toThrow("ENOSPC");
    expect(leftovers(key)).toEqual([]);
  });

  it("replacing a file keeps the old bytes intact until the new file is complete", async () => {
    const key = storage.generateKey("clip.mp4");
    await storage.save(key, Buffer.from("old"));
    vi.spyOn(fsp, "rename").mockRejectedValueOnce(new Error("rename failed"));
    await expect(storage.save(key, Buffer.from("new"))).rejects.toThrow("rename failed");
    expect(fs.readFileSync(path.join(root, key), "utf8")).toBe("old");
    expect(leftovers(key)).toEqual([key]);
    await storage.delete(key);
  });
});
