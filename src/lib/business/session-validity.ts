import type { PrismaClient } from "@prisma/client";

/** A session JWT's maximum lifetime (Auth.js default maxAge: 30 days). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Whether a signed session JWT still stands for a live account. The JWT
 * signature only proves the server issued it; this checks what may have
 * changed since: the account was blocked, deleted, its password was
 * reset/changed (User.sessionVersion moved past the version the token
 * carries), or this particular session was signed out (RevokedSession).
 * Tokens issued before sessionVersion existed carry none and count as
 * version 0, which is every account's starting value.
 */
export async function isSessionStillValid(
  prisma: PrismaClient,
  params: { userId: string; sessionVersion?: number | null; sid?: string | null },
): Promise<boolean> {
  const [user, revoked] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.userId },
      select: { status: true, sessionVersion: true },
    }),
    params.sid ? prisma.revokedSession.findUnique({ where: { sid: params.sid }, select: { sid: true } }) : null,
  ]);
  if (!user || user.status === "BLOCKED" || revoked) return false;
  return user.sessionVersion === (params.sessionVersion ?? 0);
}

/**
 * Signs out one session server-side. Needed because a JWT can't be
 * withdrawn from the browser reliably: requests already in flight at
 * sign-out (e.g. link prefetches) come back with a refreshed session
 * cookie and would silently sign the user back in. Also drops rows whose
 * JWT could no longer be valid anyway.
 */
export async function revokeSession(
  prisma: PrismaClient,
  params: { sid: string; userId: string; now?: Date },
): Promise<void> {
  const now = params.now ?? new Date();
  await prisma.$transaction([
    prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.revokedSession.upsert({
      where: { sid: params.sid },
      create: {
        sid: params.sid,
        userId: params.userId,
        revokedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
      },
      update: {},
    }),
  ]);
}
