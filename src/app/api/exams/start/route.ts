import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, toErrorResponse } from "@/lib/rbac";
import { startQuizAttempt } from "@/lib/business/quiz";

const bodySchema = z.object({ quizId: z.string() });

export async function POST(request: Request) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { quizId } = bodySchema.parse(await request.json());

    const attempt = await startQuizAttempt(prisma, {
      quizId,
      studentId: session.user.studentProfileId!,
    });

    return Response.json(attempt, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
