"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { confirmPayment, refundPayment, rejectPayment } from "@/lib/business/subscription";

export async function confirmPaymentAction(paymentId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await confirmPayment(prisma, { paymentId, adminUserId: session.user.id });

  revalidatePath("/teacher/payments");
}

export async function rejectPaymentAction(paymentId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const reason = String(formData.get("reason") ?? "لم يتم استلام المبلغ");
  await rejectPayment(prisma, { paymentId, adminUserId: session.user.id, reason });

  revalidatePath("/teacher/payments");
}

export async function refundPaymentAction(paymentId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("سبب الاسترجاع مطلوب");
  await refundPayment(prisma, { paymentId, adminUserId: session.user.id, reason });

  revalidatePath("/teacher/payments");
}
