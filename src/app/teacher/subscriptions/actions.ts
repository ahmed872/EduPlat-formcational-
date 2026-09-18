"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";

export async function createPlan(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const name = String(formData.get("name") ?? "").trim();
  const priceCents = Math.round(Number(formData.get("price") ?? 0) * 100);
  const academicYear = String(formData.get("academicYear") ?? "").trim();
  if (!name || !academicYear || Number.isNaN(priceCents) || priceCents < 0) {
    throw new Error("الرجاء إدخال بيانات صحيحة للخطة");
  }

  await prisma.subscriptionPlan.create({
    data: { name, priceCents, academicYear },
  });

  revalidatePath("/teacher/subscriptions");
}

export async function togglePlanActive(planId: string, nextActive: boolean) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.subscriptionPlan.update({
    where: { id: planId },
    data: { active: nextActive },
  });

  revalidatePath("/teacher/subscriptions");
}

export async function addPlanItem(planId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const courseId = String(formData.get("courseId") ?? "");
  if (!courseId) throw new Error("الرجاء اختيار كورس");

  const exists = await prisma.subscriptionPlanItem.findFirst({
    where: { planId, courseId },
  });
  if (exists) throw new Error("هذا الكورس مضاف بالفعل لهذه الخطة");

  await prisma.subscriptionPlanItem.create({
    data: { planId, courseId },
  });

  revalidatePath(`/teacher/subscriptions/${planId}`);
}

export async function removePlanItem(planId: string, itemId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.subscriptionPlanItem.delete({ where: { id: itemId } });

  revalidatePath(`/teacher/subscriptions/${planId}`);
}
