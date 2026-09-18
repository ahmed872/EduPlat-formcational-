"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";

function slugify(name: string) {
  return `${name.trim().toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`;
}

export async function createCategory(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const name = String(formData.get("name") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "") || null;
  if (!name) throw new Error("اسم القسم مطلوب");

  await prisma.category.create({
    data: { name, slug: slugify(name), parentId },
  });

  revalidatePath("/teacher/categories");
}

export async function archiveCategory(categoryId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.category.update({
    where: { id: categoryId },
    data: { archived: true },
  });

  revalidatePath("/teacher/categories");
}
