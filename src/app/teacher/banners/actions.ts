"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";

export async function createBanner(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("عنوان الإعلان مطلوب");

  const body = String(formData.get("body") ?? "").trim() || null;
  const ctaLabel = String(formData.get("ctaLabel") ?? "").trim() || null;
  const ctaHref = String(formData.get("ctaHref") ?? "").trim() || null;
  const startsAtRaw = String(formData.get("startsAt") ?? "");
  const endsAtRaw = String(formData.get("endsAt") ?? "");

  const order = await prisma.marketingBanner.count();
  await prisma.marketingBanner.create({
    data: {
      title,
      body,
      ctaLabel,
      ctaHref,
      startsAt: startsAtRaw ? new Date(startsAtRaw) : null,
      endsAt: endsAtRaw ? new Date(endsAtRaw) : null,
      order,
    },
  });

  revalidatePath("/teacher/banners");
  revalidatePath("/");
}

export async function toggleBannerActive(bannerId: string, currentlyActive: boolean) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.marketingBanner.update({
    where: { id: bannerId },
    data: { active: !currentlyActive },
  });

  revalidatePath("/teacher/banners");
  revalidatePath("/");
}

export async function deleteBanner(bannerId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.marketingBanner.delete({ where: { id: bannerId } });

  revalidatePath("/teacher/banners");
  revalidatePath("/");
}
