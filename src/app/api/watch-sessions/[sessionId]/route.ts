import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/rbac";
import { updateWatchProgress } from "@/lib/business/video-access";

const bodySchema = z.object({
  watchedSeconds: z.number().min(0),
  videoDurationSeconds: z.number().min(0),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { sessionId } = await context.params;
    const body = bodySchema.parse(await request.json());

    const watchSession = await prisma.watchSession.findUnique({
      where: { id: sessionId },
    });
    if (!watchSession || watchSession.studentId !== session.user.studentProfileId) {
      throw new ForbiddenError("This watch session does not belong to you");
    }

    const updated = await updateWatchProgress(prisma, {
      sessionId,
      ...body,
    });

    return Response.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}
