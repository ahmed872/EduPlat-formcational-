"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { requestParentLink } from "@/lib/business/parent-link";

export async function requestLink(formData: FormData) {
  const session = await auth();
  requireRole(session, ["PARENT"]);

  const studentEmail = String(formData.get("studentEmail") ?? "").trim();
  if (!studentEmail) throw new Error("الرجاء إدخال البريد الإلكتروني لحساب الطالب");

  await requestParentLink(prisma, { parentUserId: session.user.id, studentEmail });

  revalidatePath("/parent");
}
