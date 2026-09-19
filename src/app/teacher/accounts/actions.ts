"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { assertCanModerateUser, blockUser, unblockUser } from "@/lib/business/security";

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
