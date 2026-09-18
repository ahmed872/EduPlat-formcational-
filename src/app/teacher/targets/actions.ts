"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import type { TargetPeriod } from "@prisma/client";

export async function setDefaultTarget(period: TargetPeriod, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const targetMinutes = Number(formData.get("targetMinutes") ?? 0);
  if (!targetMinutes || targetMinutes <= 0) {
    throw new Error("الرجاء إدخال عدد دقائق صحيح");
  }

  const existing = await prisma.target.findFirst({
    where: { studentId: null, period },
  });

  if (existing) {
    await prisma.target.update({
      where: { id: existing.id },
      data: { targetMinutes, active: true },
    });
  } else {
    await prisma.target.create({
      data: { studentId: null, period, targetMinutes, active: true },
    });
  }

  revalidatePath("/teacher/targets");
}
