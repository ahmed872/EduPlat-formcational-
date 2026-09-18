import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, toErrorResponse } from "@/lib/rbac";
import { issueSignedPlaybackUrl } from "@/lib/business/playback";

const bodySchema = z.object({ videoId: z.string() });

export async function POST(request: Request) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { videoId } = bodySchema.parse(await request.json());

    const result = await issueSignedPlaybackUrl(prisma, {
      studentId: session.user.studentProfileId!,
      videoId,
    });

    if ("error" in result) {
      return Response.json({ error: result.error }, { status: 403 });
    }
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
