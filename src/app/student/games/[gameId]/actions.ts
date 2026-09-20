"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { startGameSession, submitGameScore } from "@/lib/business/games";

export async function startPlay(gameId: string) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  await startGameSession(prisma, { gameId, studentId: session.user.studentProfileId! });

  revalidatePath(`/student/games/${gameId}/play`);
}

export async function finishPlay(gameId: string, sessionId: string, answers: number[]) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  const result = await submitGameScore(prisma, {
    sessionId,
    studentId: session.user.studentProfileId!,
    answers,
  });

  revalidatePath(`/student/games/${gameId}/play`);
  revalidatePath("/student/games");

  return { score: result.score };
}
