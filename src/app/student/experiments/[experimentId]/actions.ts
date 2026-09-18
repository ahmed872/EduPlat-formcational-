"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { completeExperimentAttempt, startExperimentAttempt } from "@/lib/business/experiment";

export async function startAttempt(experimentId: string) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);
  const studentId = session.user.studentProfileId!;

  await startExperimentAttempt(prisma, { experimentId, studentId });
  revalidatePath(`/student/experiments/${experimentId}`);
}

export async function completeAttempt(
  experimentId: string,
  attemptId: string,
  checkedSteps: string[],
) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);
  const studentId = session.user.studentProfileId!;

  await completeExperimentAttempt(prisma, {
    attemptId,
    studentId,
    resultJson: { checkedSteps },
  });

  revalidatePath(`/student/experiments/${experimentId}`);
}
