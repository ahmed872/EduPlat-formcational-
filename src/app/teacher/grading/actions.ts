"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { gradeManualAnswer } from "@/lib/business/quiz";

export async function gradeAnswer(answerId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const pointsAwarded = Number(formData.get("pointsAwarded") ?? 0);
  const feedback = String(formData.get("feedback") ?? "").trim() || undefined;

  await gradeManualAnswer(prisma, {
    answerId,
    pointsAwarded,
    feedback,
    reviewerId: session.user.id,
  });

  revalidatePath("/teacher/grading");
}
