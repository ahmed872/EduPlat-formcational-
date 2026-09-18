import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkVideoAccess } from "@/lib/business/video-access";
import { verifyPlaybackToken } from "@/lib/business/playback";
import { getVideoStorageProvider } from "@/lib/storage/provider";

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

/**
 * The only route that ever reads a video file. No raw file path or public
 * URL is ever exposed to the client — this handler requires a short-lived
 * signed token (see issueSignedPlaybackUrl) AND independently re-verifies
 * the student's entitlement server-side before streaming a single byte, so
 * a token cannot outlive an access change (refund, revocation, view-limit
 * newly reached by a concurrent session).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await context.params;
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return new Response("Missing playback token", { status: 401 });

  const payload = verifyPlaybackToken(token);
  if (!payload || payload.videoId !== videoId) {
    return new Response("Invalid or expired playback token", { status: 401 });
  }

  // Defense in depth: if a session cookie is present, it must belong to the
  // same student the token was issued for (a token alone is enough to
  // stream, since a <video> element cannot attach custom auth headers, but
  // this stops a copy-pasted URL from silently working under someone
  // else's logged-in session on this same site).
  // auth() with no args reads the request-scoped headers() API, which
  // only exists inside Next's real App Router request handling (not when
  // this handler is invoked directly, e.g. from a unit test) — treat that
  // as "no session info available" rather than letting it crash the
  // request, since the token + entitlement checks below are the actual
  // security boundary; this is purely additional hardening.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  if (session?.user && session.user.studentProfileId !== payload.studentId) {
    return new Response("Token does not match the current session", { status: 403 });
  }

  const decision = await checkVideoAccess(prisma, {
    studentId: payload.studentId,
    videoId,
  });
  if (!decision.allowed) {
    return new Response(`Access no longer authorized: ${decision.reason}`, { status: 403 });
  }

  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) return new Response("Video not found", { status: 404 });

  const storage = getVideoStorageProvider();
  let size: number;
  try {
    size = await storage.getSize(video.storageKey);
  } catch {
    return new Response("Video file is not available", { status: 404 });
  }

  const rangeHeader = request.headers.get("range");
  const commonHeaders = {
    "Content-Type": "video/mp4",
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

    const nodeStream = storage.readStream(video.storageKey, { start, end });
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const nodeStream = storage.readStream(video.storageKey);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: { ...commonHeaders, "Content-Length": String(size) },
  });
}
