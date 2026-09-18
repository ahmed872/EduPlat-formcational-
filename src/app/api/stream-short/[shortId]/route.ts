import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVideoStorageProvider } from "@/lib/storage/provider";
import { streamFileResponse } from "@/lib/http/range-stream";

/**
 * Shorts are free/public by design (spec section 12) — unlike
 * /api/stream/[videoId], this route needs no signed token or entitlement
 * check, only that the Short is actually published. It still goes through
 * a controlled route rather than a public static path, keeping the
 * storage layer itself private and consistent with paid video handling.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shortId: string }> },
) {
  const { shortId } = await context.params;

  const short = await prisma.short.findUnique({ where: { id: shortId } });
  if (!short || short.status !== "PUBLISHED") {
    return new Response("Short not found", { status: 404 });
  }

  return streamFileResponse(
    getVideoStorageProvider(),
    short.storageKey,
    request.headers.get("range"),
  );
}
