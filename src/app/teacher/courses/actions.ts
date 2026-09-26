"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { getAttachmentStorageProvider, getVideoStorageProvider } from "@/lib/storage/provider";
import { validateVideoUpload } from "@/lib/business/video-upload";
import { newAttachmentStorageKey, validateAttachmentFile } from "@/lib/business/attachments";
import { setContentStatus, type ContentKind } from "@/lib/business/content-status";
import type { ContentStatus, ExperimentType } from "@prisma/client";
import { buildExperimentConfig } from "@/lib/experiments/definitions";

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
  await setCourseContentStatus(courseId, "COURSE", courseId, "PUBLISHED");
}

/**
 * Publish / Unpublish (DRAFT) / Archive for a course, lesson or video — the
 * role check is enforced again inside setContentStatus itself.
 */
export async function setCourseContentStatus(
  courseId: string,
  kind: ContentKind,
  id: string,
  status: ContentStatus,
) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  // The lesson/video must actually belong to the course in the URL, so a
  // form bound to one course can't be replayed against another course's ids.
  if (kind === "LESSON") {
    await prisma.lesson.findFirstOrThrow({ where: { id, courseId } });
  } else if (kind === "VIDEO") {
    await prisma.video.findFirstOrThrow({ where: { id, lesson: { courseId } } });
  } else if (id !== courseId) {
    throw new Error("معرّف الكورس غير متطابق");
  }

  await setContentStatus(prisma, { actorRole: session.user.role, kind, id, status });

  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath("/teacher/courses");
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
  await setCourseContentStatus(courseId, "LESSON", lessonId, "PUBLISHED");
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
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = validateVideoUpload({ type: file.type, size: file.size, bytes: buffer }, MAX_VIDEO_BYTES, "500 ميجابايت");

  const title = String(formData.get("title") ?? "").trim();
  const durationSeconds = Number(formData.get("durationSeconds") ?? 0);
  const isFree = formData.get("isFree") === "on";
  if (!title || !durationSeconds || durationSeconds <= 0) {
    throw new Error("الرجاء إدخال عنوان الفيديو ومدته بالثواني");
  }

  const storage = getVideoStorageProvider();
  const existing = await prisma.video.findUnique({ where: { lessonId } });
  const storageKey = storage.generateKey(`video${ext}`);
  await storage.save(storageKey, buffer);

  try {
    if (existing) {
      // Point the row at the new file first; the old file is removed only
      // once nothing references it (a failed update keeps the old video).
      // Replacing the file keeps the video's status: a draft or archived
      // video must not become visible just because its file changed.
      await prisma.video.update({
        where: { id: existing.id },
        data: {
          title,
          storageProvider: storage.name,
          storageKey,
          durationSeconds,
          isFree,
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
  } catch (error) {
    await storage.delete(storageKey);
    throw error;
  }
  if (existing && existing.storageKey !== storageKey) {
    await storage.delete(existing.storageKey);
  }

  revalidatePath(`/teacher/courses/${courseId}`);
}

export async function addVideoChapter(
  courseId: string,
  videoId: string,
  formData: FormData,
) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const title = String(formData.get("title") ?? "").trim();
  const timestampSeconds = Number(formData.get("timestampSeconds") ?? -1);
  if (!title || Number.isNaN(timestampSeconds) || timestampSeconds < 0) {
    throw new Error("الرجاء إدخال عنوان الفصل ولحظته الزمنية");
  }

  const order = await prisma.videoChapter.count({ where: { videoId } });
  await prisma.videoChapter.create({
    data: { videoId, title, timestampSeconds, order },
  });

  revalidatePath(`/teacher/courses/${courseId}`);
}

export async function deleteVideoChapter(courseId: string, chapterId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.videoChapter.delete({ where: { id: chapterId } });

  revalidatePath(`/teacher/courses/${courseId}`);
}

const EXPERIMENT_TYPES = new Set<ExperimentType>(["SIMULATION", "DRAG_AND_DROP", "MINI_GAME", "INTERACTIVE"]);

export type ExperimentFormState = { ok: boolean; message: string } | null;

/**
 * Creates an experiment from the type-specific editor. The fields are
 * parsed and validated by the experiment registry (including the answer
 * key, which is only ever stored server-side); errors go back to the form.
 */
export async function createExperiment(
  courseId: string,
  lessonId: string,
  _prev: ExperimentFormState,
  formData: FormData,
): Promise<ExperimentFormState> {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const type = String(formData.get("type") ?? "") as ExperimentType;
  const title = String(formData.get("title") ?? "").trim();
  const isRequired = formData.get("isRequired") === "on";

  if (!EXPERIMENT_TYPES.has(type)) return { ok: false, message: "نوع التجربة غير صالح" };
  if (!title) return { ok: false, message: "الرجاء إدخال عنوان التجربة" };
  const lesson = await prisma.lesson.findFirst({ where: { id: lessonId, courseId }, select: { id: true } });
  if (!lesson) return { ok: false, message: "الدرس غير موجود في هذا الكورس" };

  let config: unknown;
  try {
    config = buildExperimentConfig(type, formData);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const order = await prisma.experiment.count({ where: { lessonId } });
  await prisma.experiment.create({
    data: { lessonId, type, title, order, isRequired, config: config as never },
  });

  revalidatePath(`/teacher/courses/${courseId}`);
  return { ok: true, message: "تمت إضافة التجربة" };
}

export async function deleteExperiment(courseId: string, experimentId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.experiment.deleteMany({ where: { id: experimentId, lesson: { courseId } } });

  revalidatePath(`/teacher/courses/${courseId}`);
}

export type AttachmentFormState = { ok: boolean; message: string } | null;

/** Uploads a lesson attachment into private storage after validating it. */
export async function uploadLessonAttachment(
  courseId: string,
  lessonId: string,
  _prev: AttachmentFormState,
  formData: FormData,
): Promise<AttachmentFormState> {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const lesson = await prisma.lesson.findFirst({ where: { id: lessonId, courseId }, select: { id: true } });
  if (!lesson) return { ok: false, message: "الدرس غير موجود في هذا الكورس" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "الرجاء اختيار ملف" };
  const label = String(formData.get("label") ?? "").trim().slice(0, 120) || null;

  let detected;
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    detected = validateAttachmentFile({ name: file.name, bytes });
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const storage = getAttachmentStorageProvider();
  const storageKey = newAttachmentStorageKey(detected.ext);
  await storage.save(storageKey, bytes);
  try {
    await prisma.attachment.create({
      data: {
        lessonId,
        storageKey,
        originalName: detected.originalName,
        mimeType: detected.mimeType,
        fileType: detected.fileType,
        sizeBytes: bytes.length,
        label,
      },
    });
  } catch (error) {
    await storage.delete(storageKey);
    throw error;
  }

  revalidatePath(`/teacher/courses/${courseId}`);
  return { ok: true, message: "تم رفع الملف" };
}

export async function deleteLessonAttachment(courseId: string, attachmentId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, lesson: { courseId } },
    select: { id: true, storageKey: true },
  });
  if (!attachment) return;
  await prisma.attachment.delete({ where: { id: attachment.id } });
  await getAttachmentStorageProvider().delete(attachment.storageKey);

  revalidatePath(`/teacher/courses/${courseId}`);
}
