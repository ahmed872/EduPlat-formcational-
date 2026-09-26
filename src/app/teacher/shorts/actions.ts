"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { getVideoStorageProvider } from "@/lib/storage/provider";
import { validateVideoUpload } from "@/lib/business/video-upload";
import {
  PLATFORM_SETTING_KEYS,
  getPlatformSetting,
} from "@/lib/platform-settings";

const MAX_SHORT_BYTES = 100 * 1024 * 1024; // Shorts are short clips — cap well below full lesson videos

export async function uploadShort(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const file = formData.get("video");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("الرجاء اختيار ملف فيديو قصير");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = validateVideoUpload({ type: file.type, size: file.size, bytes: buffer }, MAX_SHORT_BYTES, "100 ميجابايت للشورتس");

  const title = String(formData.get("title") ?? "").trim();
  const durationSeconds = Number(formData.get("durationSeconds") ?? 0);
  if (!title || !durationSeconds || durationSeconds <= 0) {
    throw new Error("الرجاء إدخال عنوان الفيديو ومدته بالثواني");
  }

  const maxDuration = await getPlatformSetting<number>(
    PLATFORM_SETTING_KEYS.SHORT_MAX_DURATION_SECONDS,
  );
  if (durationSeconds > maxDuration) {
    throw new Error(`مدة الشورت أطول من الحد المسموح (${maxDuration} ثانية)`);
  }

  const sourceVideoId = String(formData.get("sourceVideoId") ?? "") || null;
  const sourceTimestampRaw = formData.get("sourceTimestampSeconds");
  const sourceTimestampSeconds = sourceTimestampRaw
    ? Number(sourceTimestampRaw)
    : null;
  if (sourceVideoId && (sourceTimestampSeconds === null || sourceTimestampSeconds < 0)) {
    throw new Error("الرجاء تحديد اللحظة الزمنية داخل الفيديو الأصلي");
  }

  const storage = getVideoStorageProvider();
  const storageKey = storage.generateKey(`short${ext}`);
  await storage.save(storageKey, buffer);

  try {
    await prisma.short.create({
      data: {
        title,
        storageProvider: storage.name,
        storageKey,
        durationSeconds,
        sourceVideoId,
        sourceTimestampSeconds,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  } catch (error) {
    // Don't leave an unreferenced file behind.
    await storage.delete(storageKey);
    throw error;
  }

  revalidatePath("/teacher/shorts");
  revalidatePath("/shorts");
}

export async function toggleShortStatus(shortId: string, publish: boolean) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.short.update({
    where: { id: shortId },
    data: {
      status: publish ? "PUBLISHED" : "ARCHIVED",
      publishedAt: publish ? new Date() : null,
    },
  });

  revalidatePath("/teacher/shorts");
  revalidatePath("/shorts");
}
