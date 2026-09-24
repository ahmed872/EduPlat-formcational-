import { Readable, Transform } from "node:stream";
import type { StorageProvider } from "@/lib/storage/provider";

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

/**
 * Shared HTTP Range (206 Partial Content) responder used by both the paid
 * video stream route and the (unauthenticated, always-free) Shorts stream
 * route, so seeking/scrubbing works identically for both.
 */
export async function streamFileResponse(
  storage: StorageProvider,
  storageKey: string,
  rangeHeader: string | null,
  contentType = "video/mp4",
  /** Called once the response body is finished or aborted, with the bytes
   * actually handed to the client from `start` — used for server-side
   * view accounting. Errors in it never affect the response. */
  onDelivered?: (delivered: { start: number; bytes: number; size: number }) => Promise<unknown> | void,
): Promise<Response> {
  let size: number;
  try {
    size = await storage.getSize(storageKey);
  } catch {
    return new Response("File is not available", { status: 404 });
  }

  const commonHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };

  if (rangeHeader) {
    const match = RANGE_PATTERN.exec(rangeHeader);
    if (!match) {
      return new Response("Malformed Range header", { status: 416 });
    }
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    const nodeStream = counted(storage.readStream(storageKey, { start, end }), start, size, onDelivered);
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const nodeStream = counted(storage.readStream(storageKey), 0, size, onDelivered);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: { ...commonHeaders, "Content-Length": String(size) },
  });
}

function counted(
  source: Readable,
  start: number,
  size: number,
  onDelivered?: (delivered: { start: number; bytes: number; size: number }) => Promise<unknown> | void,
): Readable {
  if (!onDelivered) return source;
  let bytes = 0;
  let reported = false;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const report = () => {
    if (reported) return;
    reported = true;
    Promise.resolve()
      .then(() => onDelivered({ start, bytes, size }))
      .catch((error) => console.error("[stream] delivery accounting failed:", (error as Error).message));
  };
  source.on("error", (error) => counter.destroy(error));
  counter.once("close", report);
  counter.once("end", report);
  // A cancelled response (client aborted) destroys the counter; stop reading the file too.
  counter.once("close", () => source.destroy());
  source.pipe(counter);
  return counter;
}
