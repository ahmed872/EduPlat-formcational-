import type { PrismaClient } from "@prisma/client";
import { checkVideoAccess } from "@/lib/business/video-access";

export type ShortCallToAction =
  | { type: "NO_SOURCE" }
  | { type: "OPEN_ORIGINAL"; videoId: string; timestampSeconds: number }
  | { type: "SUBSCRIBE_CTA"; reason: "GUEST" | "NOT_ENTITLED" };

/**
 * Shorts themselves are always free (spec section 12) — this only decides
 * what happens when the student taps "شاهد الدرس الكامل" at the end of one.
 * A guest (no studentId) always gets the subscribe/login CTA; a logged-in
 * student gets the real entitlement check via checkVideoAccess, the same
 * gate every paid video goes through.
 */
export async function resolveShortCallToAction(
  prisma: PrismaClient,
  params: { shortId: string; studentId: string | null },
): Promise<ShortCallToAction> {
  const short = await prisma.short.findUniqueOrThrow({
    where: { id: params.shortId },
  });

  if (!short.sourceVideoId || short.sourceTimestampSeconds === null) {
    return { type: "NO_SOURCE" };
  }

  if (!params.studentId) {
    return { type: "SUBSCRIBE_CTA", reason: "GUEST" };
  }

  const decision = await checkVideoAccess(prisma, {
    studentId: params.studentId,
    videoId: short.sourceVideoId,
  });

  if (!decision.allowed) {
    return { type: "SUBSCRIBE_CTA", reason: "NOT_ENTITLED" };
  }

  return {
    type: "OPEN_ORIGINAL",
    videoId: short.sourceVideoId,
    timestampSeconds: short.sourceTimestampSeconds,
  };
}
