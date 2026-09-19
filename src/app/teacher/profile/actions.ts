"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { updateTeacherProfile } from "@/lib/business/teacher-profile";

export async function saveProfile(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await updateTeacherProfile(prisma, {
    userId: session.user.id,
    bio: String(formData.get("bio") ?? "").trim() || null,
    photoUrl: String(formData.get("photoUrl") ?? "").trim() || null,
    education: String(formData.get("education") ?? "").trim() || null,
    experience: String(formData.get("experience") ?? "").trim() || null,
    philosophy: String(formData.get("philosophy") ?? "").trim() || null,
  });

  revalidatePath("/teacher/profile");
}
