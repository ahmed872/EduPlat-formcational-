"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import {
  grantAdminEntitlement,
  grantLessonToCourseSubscribers,
} from "@/lib/business/video-access";

export async function grantEntitlementAction(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const email = String(formData.get("studentEmail") ?? "").trim().toLowerCase();
  const lessonId = String(formData.get("lessonId") ?? "");
  const expiresAtRaw = String(formData.get("expiresAt") ?? "");
  if (!email || !lessonId) {
    throw new Error("الرجاء إدخال بريد الطالب واختيار الدرس");
  }

  const student = await prisma.studentProfile.findFirst({
    where: { user: { email } },
  });
  if (!student) {
    throw new Error("لا يوجد طالب مسجّل بهذا البريد الإلكتروني");
  }

  await grantAdminEntitlement(prisma, {
    studentId: student.id,
    lessonId,
    grantedById: session.user.id,
    expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : undefined,
  });

  revalidatePath("/teacher/entitlements");
}

export async function grantLessonToSubscribersAction(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const lessonId = String(formData.get("lessonId") ?? "");
  if (!lessonId) throw new Error("الرجاء اختيار الدرس");

  await grantLessonToCourseSubscribers(prisma, {
    lessonId,
    grantedById: session.user.id,
  });

  revalidatePath("/teacher/entitlements");
  revalidatePath("/teacher/audit-log");
}
