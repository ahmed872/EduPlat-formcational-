"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";

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
