import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { checkVideoAccess } from "@/lib/business/video-access";

/**
 * How long an issued playback URL stays valid. Generous enough that a
 * single `<video>` element's many HTTP Range requests over a normal
 * viewing session don't get cut off mid-playback (the URL itself doesn't
 * change as the browser seeks/buffers). A real CDN-backed provider
 * (CloudFront/S3 presigned URLs, Mux JWT playback IDs) would typically use
 * a shorter window with per-segment re-authorization (HLS); that requires
 * a real media pipeline (ffmpeg or a provider that does it for you), which
 * is not available in this environment — see PROJECT_STATUS.md.
 */
const PLAYBACK_TOKEN_TTL_SECONDS = 4 * 60 * 60;

function getSigningSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("base64url");
}

export interface PlaybackTokenPayload {
  studentId: string;
  videoId: string;
  /** The WatchSession this playback belongs to — delivered bytes are
   * accounted against it, so the view limit is enforced server-side. */
  sessionId: string;
  exp: number; // unix seconds
}

/** HMAC-signed, tamper-evident, time-limited — not a real DRM license. */
export function issuePlaybackToken(payload: PlaybackTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyPlaybackToken(token: string): PlaybackTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8"),
    ) as PlaybackTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    // Tokens minted before playback was bound to a watch session carry no
    // sessionId and are no longer accepted; the player simply asks again.
    if (typeof payload.sessionId !== "string" || !payload.sessionId) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * The single gate for handing out a playable URL. Re-runs the full
 * entitlement/view-limit check at issuance time — a previously issued
 * token is never treated as proof of current access (the streaming route
 * re-checks again on every request too, since access can be revoked
 * mid-window).
 */
export async function issueSignedPlaybackUrl(
  prisma: PrismaClient,
  params: { studentId: string; videoId: string },
): Promise<{ url: string; expiresAt: Date; sessionId: string } | { error: string }> {
  const decision = await checkVideoAccess(prisma, params);
  if (!decision.allowed) {
    return { error: decision.reason };
  }

  // Every playback URL belongs to its own watch session: the stream route
  // accounts the bytes it delivers against it (see recordDeliveredRange).
  const watchSession = await prisma.watchSession.create({
    data: { studentId: params.studentId, videoId: params.videoId },
  });
  const exp = Math.floor(Date.now() / 1000) + PLAYBACK_TOKEN_TTL_SECONDS;
  const token = issuePlaybackToken({
    studentId: params.studentId,
    videoId: params.videoId,
    sessionId: watchSession.id,
    exp,
  });

  return {
    url: `/api/stream/${params.videoId}?token=${token}`,
    expiresAt: new Date(exp * 1000),
    sessionId: watchSession.id,
  };
}
