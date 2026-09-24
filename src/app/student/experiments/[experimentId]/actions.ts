"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import {
  playExperimentMove,
  startExperimentAttempt,
  submitExperimentAttempt,
} from "@/lib/business/experiment";

async function studentId() {
  const session = await auth();
  requireRole(session, ["STUDENT"]);
  return session.user.studentProfileId!;
}

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "حدث خطأ" };
  }
}

export async function startAttempt(experimentId: string) {
  const id = await studentId();
  await startExperimentAttempt(prisma, { experimentId, studentId: id });
  revalidatePath(`/student/experiments/${experimentId}`);
}

export async function submitAttempt(experimentId: string, attemptId: string, submission: unknown) {
  const id = await studentId();
  const result = await attempt(() =>
    submitExperimentAttempt(prisma, { attemptId, studentId: id, submission }),
  );
  revalidatePath(`/student/experiments/${experimentId}`);
  return result;
}

export async function playMove(experimentId: string, attemptId: string, move: unknown) {
  const id = await studentId();
  const result = await attempt(() => playExperimentMove(prisma, { attemptId, studentId: id, move }));
  if (result.ok && result.value.finished) revalidatePath(`/student/experiments/${experimentId}`);
  return result;
}
