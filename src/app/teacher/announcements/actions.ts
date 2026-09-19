"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { publishAnnouncement } from "@/lib/business/announcements";
import type { AnnouncementAudience } from "@prisma/client";

export async function createAnnouncement(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const audienceType = String(formData.get("audienceType") ?? "") as AnnouncementAudience;
  if (!title || !body || !audienceType) {
    throw new Error("الرجاء إدخال العنوان والنص واختيار الجمهور");
  }

  let audienceRefId: string | null = null;
  if (audienceType === "CATEGORY") {
    audienceRefId = String(formData.get("audienceCategoryId") ?? "") || null;
  } else if (audienceType === "COURSE") {
    audienceRefId = String(formData.get("audienceCourseId") ?? "") || null;
  } else if (audienceType === "STUDENT") {
    audienceRefId = String(formData.get("audienceStudentId") ?? "") || null;
  }

  await publishAnnouncement(prisma, {
    teacherId: session.user.id,
    title,
    body,
    audienceType,
    audienceRefId,
  });

  revalidatePath("/teacher/announcements");
}
