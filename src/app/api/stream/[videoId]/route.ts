import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkVideoAccess, recordDeliveredRange } from "@/lib/business/video-access";
import { verifyPlaybackToken } from "@/lib/business/playback";
import { getVideoStorageProvider } from "@/lib/storage/provider";
import { streamFileResponse } from "@/lib/http/range-stream";

/**
 * The only route that ever reads a paid video file. No raw file path or
 * public URL is ever exposed to the client — this handler requires a
 * short-lived signed token (see issueSignedPlaybackUrl) AND independently
 * re-verifies the student's entitlement server-side before streaming a
 * single byte, so a token cannot outlive an access change (refund,
 * revocation, view-limit newly reached by a concurrent session).
 *
 * Wrapped with `auth()`'s middleware form (rather than calling the no-arg
 * `auth()` inside the body) so the session is decoded directly from the
 * request's cookies, not from Next's request-scoped `headers()` context —
 * this is what makes it possible to actually unit-test the session-binding
 * rule below with a real signed cookie, which is exactly the test coverage
 * the original audit said was missing to safely make this change.
 */
export const GET = auth(async function GET(request, context) {
  const { videoId } = (await context.params) as { videoId: string };
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return new Response("Missing playback token", { status: 401 });

  const payload = verifyPlaybackToken(token);
  if (!payload || payload.videoId !== videoId) {
    return new Response("Invalid or expired playback token", { status: 401 });
  }

  // A signed token alone is not proof of the *current* viewer's identity —
  // a real, live session matching the token's studentId is required
  // unconditionally, not only when a cookie happens to be present. Without
  // this, a copy-pasted URL worked for any bearer — logged in or not — for
  // the token's full 4-hour lifetime, as long as the underlying entitlement
  // was still active (the gap fixed here). `request.auth` also carries the
  // live blocked-status re-check from auth.ts's session callback, so a
  // blocked student's still-valid cookie is rejected here too.
  if (request.auth?.user?.studentProfileId !== payload.studentId) {
    return new Response("Token does not match the current session", { status: 403 });
  }

  const watchSession = await prisma.watchSession.findUnique({ where: { id: payload.sessionId } });
  if (!watchSession || watchSession.studentId !== payload.studentId || watchSession.videoId !== videoId) {
    return new Response("Invalid playback session", { status: 403 });
  }

  const decision = await checkVideoAccess(prisma, {
    studentId: payload.studentId,
    videoId,
  });
  // The view that used up the last allowed slot may still be finished —
  // it was paid for. Any other session is refused once the limit is hit.
  const finishingPaidView = decision.reason === "VIEW_LIMIT_REACHED" && watchSession.consumedView;
  if (!decision.allowed && !finishingPaidView) {
    return new Response(`Access no longer authorized: ${decision.reason}`, { status: 403 });
  }

  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) return new Response("Video not found", { status: 404 });

  // Server-side view accounting: what counts toward the view limit is the
  // share of the file this session actually received, not what the player
  // chooses to report.
  return streamFileResponse(
    getVideoStorageProvider(),
    video.storageKey,
    request.headers.get("range"),
    "video/mp4",
    video.isFree
      ? undefined
      : ({ start, bytes, size }) =>
          recordDeliveredRange(prisma, { sessionId: watchSession.id, fileSize: size, start, bytes }),
  );
});
