"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { addTeacherCommentToReport, generateParentReport } from "@/lib/business/reports";

export async function createReport(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const studentId = String(formData.get("studentId") ?? "");
  const periodStartRaw = String(formData.get("periodStart") ?? "");
  const periodEndRaw = String(formData.get("periodEnd") ?? "");
  if (!studentId || !periodStartRaw || !periodEndRaw) {
    throw new Error("الرجاء اختيار الطالب وفترة التقرير كاملة");
  }

  const periodStart = new Date(periodStartRaw);
  // The <input type="date"> value parses to UTC midnight; extend the end
  // date to the end of that day so the last day's activity isn't excluded.
  const periodEnd = new Date(periodEndRaw);
  periodEnd.setUTCHours(23, 59, 59, 999);
  if (periodEnd < periodStart) {
    throw new Error("نهاية الفترة يجب أن تكون بعد بدايتها");
  }

  await generateParentReport(prisma, { studentId, periodStart, periodEnd });

  revalidatePath("/teacher/reports");
}

export async function addComment(reportId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const comment = String(formData.get("comment") ?? "").trim();
  if (!comment) throw new Error("الرجاء كتابة ملاحظة");

  await addTeacherCommentToReport(prisma, { reportId, comment });

  revalidatePath("/teacher/reports");
}
