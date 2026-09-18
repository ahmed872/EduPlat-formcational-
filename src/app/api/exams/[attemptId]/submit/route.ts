import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/rbac";
import { submitQuizAttempt } from "@/lib/business/quiz";

const bodySchema = z.object({
  answers: z.array(z.object({ questionId: z.string(), studentAnswer: z.unknown() })),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> },
) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { attemptId } = await context.params;
    const { answers } = bodySchema.parse(await request.json());

    const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.studentId !== session.user.studentProfileId) {
      throw new ForbiddenError("This attempt does not belong to you");
    }

    const graded = await submitQuizAttempt(prisma, { attemptId, answers });
    return Response.json(graded);
  } catch (error) {
    return toErrorResponse(error);
  }
}
