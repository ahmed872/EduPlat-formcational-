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

// submitAttempt / playMove deliberately don't revalidate the page: that
// would re-render it mid-interaction and unmount the result the student is
// looking at. The client refreshes itself once the student moves on
// (use-submit.tsx on a pass, the mini game's "continue" button).
// experimentId stays in the signature so the page's action calls are uniform.
export async function submitAttempt(_experimentId: string, attemptId: string, submission: unknown) {
  const id = await studentId();
  return attempt(() => submitExperimentAttempt(prisma, { attemptId, studentId: id, submission }));
}

export async function playMove(_experimentId: string, attemptId: string, move: unknown) {
  const id = await studentId();
  return attempt(() => playExperimentMove(prisma, { attemptId, studentId: id, move }));
}
