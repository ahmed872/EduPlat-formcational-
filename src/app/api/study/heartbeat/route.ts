import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, toErrorResponse } from "@/lib/rbac";
import { recordHeartbeat } from "@/lib/business/study-time";

const bodySchema = z.object({
  type: z.enum(["VIDEO", "EXERCISE"]),
  refId: z.string(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { type, refId } = bodySchema.parse(await request.json());

    const result = await recordHeartbeat(prisma, {
      studentId: session.user.studentProfileId!,
      type,
      refId,
    });

    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
