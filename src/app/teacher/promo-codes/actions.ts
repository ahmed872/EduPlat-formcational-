"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import type { PromoType } from "@prisma/client";

const CONTENT_REQUIRED_TYPES: PromoType[] = ["FREE_LESSON", "FREE_PACKAGE", "FREE_PERIOD"];

export async function createPromoCode(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const type = String(formData.get("type") ?? "") as PromoType;
  const valueRaw = formData.get("value");
  const value = valueRaw ? Number(valueRaw) : null;
  const usageLimitRaw = formData.get("usageLimit");
  const usageLimit = usageLimitRaw ? Number(usageLimitRaw) : null;
  const expiresAtRaw = String(formData.get("expiresAt") ?? "");
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
  const courseId = String(formData.get("courseId") ?? "") || null;

  if (!code || !type) throw new Error("الرجاء إدخال الكود ونوعه");
  if (CONTENT_REQUIRED_TYPES.includes(type) && !courseId) {
    throw new Error("هذا النوع من الأكواد يتطلب اختيار كورس مرتبط");
  }

  await prisma.promoCode.create({
    data: {
      code,
      type,
      value,
      usageLimit,
      expiresAt,
      applicableContent: courseId
        ? { create: [{ courseId }] }
        : undefined,
    },
  });

  revalidatePath("/teacher/promo-codes");
}

export async function togglePromoActive(promoId: string, nextActive: boolean) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.promoCode.update({
    where: { id: promoId },
    data: { active: nextActive },
  });

  revalidatePath("/teacher/promo-codes");
}
