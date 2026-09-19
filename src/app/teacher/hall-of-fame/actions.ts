"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { approveHallOfFameEntry, generateHallOfFameCandidates } from "@/lib/business/leaderboard";

export async function generateCandidates(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("الرجاء اختيار شهر صالح");

  await generateHallOfFameCandidates(prisma, { month });

  revalidatePath("/teacher/hall-of-fame");
}

export async function approveEntry(entryId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await approveHallOfFameEntry(prisma, { entryId, approvedById: session.user.id });

  revalidatePath("/teacher/hall-of-fame");
}
