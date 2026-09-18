import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, toErrorResponse } from "@/lib/rbac";
import { startWatchSession } from "@/lib/business/video-access";

const bodySchema = z.object({ videoId: z.string() });

export async function POST(request: Request) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { videoId } = bodySchema.parse(await request.json());

    const watchSession = await startWatchSession(prisma, {
      studentId: session.user.studentProfileId!,
      videoId,
    });

    return Response.json(watchSession, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
