"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { getVideoStorageProvider } from "@/lib/storage/provider";

const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB — matches next.config.ts server action body limit

export async function createCourse(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "");
  const academicYear = String(formData.get("academicYear") ?? "").trim();
  if (!title || !categoryId || !academicYear) {
    throw new Error("الرجاء إدخال كل الحقول المطلوبة");
  }

  const course = await prisma.course.create({
    data: {
      title,
      categoryId,
      academicYear,
      teacherId: session.user.id,
      status: "DRAFT",
    },
  });

  revalidatePath("/teacher/courses");
  redirect(`/teacher/courses/${course.id}`);
}

export async function publishCourse(courseId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.course.update({
    where: { id: courseId },
    data: { status: "PUBLISHED" },
  });

  revalidatePath(`/teacher/courses/${courseId}`);
}

export async function createLesson(courseId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const title = String(formData.get("title") ?? "").trim();
  const isFree = formData.get("isFree") === "on";
  const requiredPreviousLessonId =
    String(formData.get("requiredPreviousLessonId") ?? "") || null;
  if (!title) throw new Error("عنوان الدرس مطلوب");

  const lessonCount = await prisma.lesson.count({ where: { courseId } });

  await prisma.lesson.create({
    data: {
      courseId,
      title,
      isFree,
      order: lessonCount,
      requiredPreviousLessonId,
      status: "DRAFT",
    },
  });

  revalidatePath(`/teacher/courses/${courseId}`);
}

export async function publishLesson(courseId: string, lessonId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.lesson.update({
    where: { id: lessonId },
    data: { status: "PUBLISHED", releaseAt: new Date() },
  });

  revalidatePath(`/teacher/courses/${courseId}`);
}

/**
 * Stores the uploaded file in private storage (see src/lib/storage/provider.ts
 * — never in `public/`, never returning a public URL) and creates/replaces
 * the Video row for this lesson. Duration is teacher-entered because no
 * media-probing tool (ffprobe) is available in this environment to detect
 * it automatically — documented in PROJECT_STATUS.md.
 */
export async function uploadLessonVideo(
  courseId: string,
  lessonId: string,
  formData: FormData,
) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const file = formData.get("video");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("الرجاء اختيار ملف فيديو");
  }
  if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
    throw new Error("صيغة الفيديو غير مدعومة (MP4 أو WebM أو MOV فقط)");
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("حجم الفيديو أكبر من الحد المسموح (500 ميجابايت)");
  }

  const title = String(formData.get("title") ?? "").trim();
  const durationSeconds = Number(formData.get("durationSeconds") ?? 0);
  const isFree = formData.get("isFree") === "on";
  if (!title || !durationSeconds || durationSeconds <= 0) {
    throw new Error("الرجاء إدخال عنوان الفيديو ومدته بالثواني");
  }

  const storage = getVideoStorageProvider();
  const existing = await prisma.video.findUnique({ where: { lessonId } });
  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = storage.generateKey(file.name);
  await storage.save(storageKey, buffer);

  if (existing) {
    await storage.delete(existing.storageKey);
    await prisma.video.update({
      where: { id: existing.id },
      data: {
        title,
        storageProvider: storage.name,
        storageKey,
        durationSeconds,
        isFree,
        status: "PUBLISHED",
      },
    });
  } else {
    await prisma.video.create({
      data: {
        lessonId,
        title,
        storageProvider: storage.name,
        storageKey,
        durationSeconds,
        isFree,
        status: "PUBLISHED",
      },
    });
  }

  revalidatePath(`/teacher/courses/${courseId}`);
}
