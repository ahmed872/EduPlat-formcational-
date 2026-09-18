"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { startSubscriptionCheckout } from "@/lib/business/subscription";
import { redeemFreeContentPromo } from "@/lib/business/subscription";

export async function subscribeToPlan(formData: FormData) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  const planId = String(formData.get("planId") ?? "");
  const promoCode = String(formData.get("promoCode") ?? "").trim() || undefined;
  if (!planId) throw new Error("الرجاء اختيار خطة");

  await startSubscriptionCheckout(prisma, {
    studentId: session.user.studentProfileId!,
    planId,
    promoCode,
  });

  revalidatePath("/student/subscribe");
  revalidatePath("/student/payments");
}

export async function redeemFreeCode(formData: FormData) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  const code = String(formData.get("freeCode") ?? "").trim();
  if (!code) throw new Error("الرجاء إدخال الكود");

  await redeemFreeContentPromo(prisma, {
    code,
    studentId: session.user.studentProfileId!,
  });

  revalidatePath("/student/subscribe");
  revalidatePath("/student");
}
