"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";

export async function createProduct(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const priceCents = Math.round(Number(formData.get("price") ?? 0) * 100);
  const stock = Number(formData.get("stock") ?? 0);
  if (!title || !Number.isFinite(priceCents) || priceCents < 0 || !Number.isFinite(stock) || stock < 0) {
    throw new Error("الرجاء إدخال اسم المنتج وسعر وكمية صالحين");
  }

  await prisma.product.create({
    data: { title, description, priceCents, stock },
  });

  revalidatePath("/teacher/products");
}

export async function toggleProductStatus(productId: string, currentStatus: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.product.update({
    where: { id: productId },
    data: { status: currentStatus === "PUBLISHED" ? "ARCHIVED" : "PUBLISHED" },
  });

  revalidatePath("/teacher/products");
}

export async function restockProduct(productId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const amount = Number(formData.get("amount") ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("الرجاء إدخال كمية صالحة لإعادة التخزين");
  }

  await prisma.product.update({
    where: { id: productId },
    data: { stock: { increment: amount } },
  });

  revalidatePath("/teacher/products");
}
