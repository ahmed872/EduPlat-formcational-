"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import {
  ACHIEVEMENT_METRICS,
  awardCustomAchievement,
  type AchievementMetric,
} from "@/lib/business/achievements";

export async function createAchievement(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const code = String(formData.get("code") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const icon = String(formData.get("icon") ?? "").trim() || null;
  const isCustom = formData.get("isCustom") === "on";

  if (!code || !title) {
    throw new Error("الرجاء إدخال رمز وعنوان الإنجاز");
  }

  let criteriaJson: { metric: string; threshold: number };
  if (isCustom) {
    // No automatic condition — this achievement is only ever granted by a
    // teacher's explicit action (see awardAchievement below).
    criteriaJson = { metric: "MANUAL", threshold: 0 };
  } else {
    const metric = String(formData.get("metric") ?? "");
    const threshold = Number(formData.get("threshold") ?? 0);
    if (!(ACHIEVEMENT_METRICS as readonly string[]).includes(metric)) {
      throw new Error("الرجاء اختيار مقياس صالح للإنجاز الآلي");
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error("الحد المطلوب يجب أن يكون رقمًا أكبر من صفر");
    }
    criteriaJson = { metric: metric as AchievementMetric, threshold };
  }

  await prisma.achievement.create({
    data: { code, title, description, icon, isCustom, criteriaJson },
  });

  revalidatePath("/teacher/achievements");
}

export async function awardAchievement(achievementId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) throw new Error("الرجاء اختيار طالب");

  await awardCustomAchievement(prisma, { achievementId, studentId });

  revalidatePath("/teacher/achievements");
}
