import type { UserRole } from "@prisma/client";
import type { Session } from "next-auth";

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Server-side authorization gate. Every protected API route/server action
 * must call this instead of trusting client-supplied role claims. Throws so
 * callers get a fail-closed default; route handlers catch and map to an
 * HTTP response (see `toErrorResponse`).
 */
export function requireRole(
  session: Session | null,
  allowedRoles: UserRole[],
): asserts session is Session {
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  if (!allowedRoles.includes(session.user.role)) {
    throw new ForbiddenError(
      `Role ${session.user.role} is not permitted to access this resource`,
    );
  }
}

export function requireSession(
  session: Session | null,
): asserts session is Session {
  if (!session?.user) {
    throw new UnauthorizedError();
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ error: "Unknown error" }, { status: 500 });
}
