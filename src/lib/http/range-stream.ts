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
    const range = resolveRange(match[1], match[2], size);
    if (!range) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const { start, end } = range;

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

/**
 * RFC 9110 §14.1.2 byte ranges: "a-b" with b past the end is served up to
 * the last byte (players ask for fixed-size chunks and the final one runs
 * past the end); "a-" is the rest of the file; "-n" is the LAST n bytes.
 * Only a start at or past the end (or an empty file) is unsatisfiable.
 */
export function resolveRange(first: string, last: string, size: number): { start: number; end: number } | null {
  if (size <= 0) return null;
  if (first === "") {
    if (last === "") return null;
    const suffix = parseInt(last, 10);
    if (!(suffix > 0)) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = parseInt(first, 10);
  const end = last === "" ? size - 1 : Math.min(parseInt(last, 10), size - 1);
  if (Number.isNaN(start) || Number.isNaN(end) || start >= size || start > end) return null;
  return { start, end };
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
