import { encode } from "next-auth/jwt";

/**
 * Builds a `Cookie` header value carrying a real, correctly-signed NextAuth
 * v5 session JWT for the given user — for tests that exercise a route
 * wrapped with `auth()`'s middleware form (which decodes the session
 * straight from the request's cookies, not from Next's request-scoped
 * `headers()` context, so this works from a plain function call in Vitest).
 */
export async function sessionCookieFor(user: {
  id: string;
  role: string;
  studentProfileId?: string | null;
  parentProfileId?: string | null;
  sessionVersion?: number;
  sid?: string;
}): Promise<string> {
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    token: {
      id: user.id,
      role: user.role,
      studentProfileId: user.studentProfileId ?? null,
      parentProfileId: user.parentProfileId ?? null,
      ...(user.sessionVersion === undefined ? {} : { sessionVersion: user.sessionVersion }),
      ...(user.sid === undefined ? {} : { sid: user.sid }),
      sub: user.id,
    },
  });
  return `authjs.session-token=${token}`;
}
