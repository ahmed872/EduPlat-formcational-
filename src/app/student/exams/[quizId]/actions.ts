"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { startQuizAttempt } from "@/lib/business/quiz";

export async function startAttempt(quizId: string) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  await startQuizAttempt(prisma, {
    quizId,
    studentId: session.user.studentProfileId!,
  });

  revalidatePath(`/student/exams/${quizId}`);
}
