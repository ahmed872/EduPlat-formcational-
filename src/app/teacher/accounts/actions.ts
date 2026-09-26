"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { assertCanModerateUser, blockUser, unblockUser } from "@/lib/business/security";
import { issueResetLinkForUser } from "@/lib/business/password-reset";

export async function block(userId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("الرجاء كتابة سبب الحظر");

  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assertCanModerateUser(target);

  await blockUser(prisma, { userId, reason, blockedById: session.user.id });

  revalidatePath("/teacher/accounts");
}

export async function unblock(userId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await unblockUser(prisma, { userId, actorId: session.user.id });

  revalidatePath("/teacher/accounts");
}

export type ResetLinkState = { ok: true; resetPath: string; expiresAt: string } | { ok: false; message: string } | null;

/**
 * Issues a one-time reset link for a student/parent who can't receive
 * email. Returned once to the teacher (never stored in plain form, never
 * logged); issuing again replaces the previous link. Audit-logged.
 */
export async function issueResetLink(userId: string): Promise<ResetLinkState> {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);
  try {
    const { resetPath, expiresAt } = await issueResetLinkForUser(prisma, {
      targetUserId: userId,
      actorUserId: session.user.id,
    });
    return { ok: true, resetPath, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "تعذر إنشاء الرابط" };
  }
}
