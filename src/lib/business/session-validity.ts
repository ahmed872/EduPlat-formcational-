import type { PrismaClient } from "@prisma/client";

/**
 * Whether a signed session JWT still stands for a live account. The JWT
 * signature only proves the server issued it; this checks what may have
 * changed since: the account was blocked, deleted, or its password was
 * reset/changed (User.sessionVersion moved past the version the token
 * carries). Tokens issued before sessionVersion existed carry none and
 * count as version 0, which is every account's starting value.
 */
export async function isSessionStillValid(
  prisma: PrismaClient,
  params: { userId: string; sessionVersion?: number | null },
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { status: true, sessionVersion: true },
  });
  if (!user || user.status === "BLOCKED") return false;
  return user.sessionVersion === (params.sessionVersion ?? 0);
}
