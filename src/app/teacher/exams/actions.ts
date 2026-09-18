"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import type { ExamType } from "@prisma/client";

export async function createExam(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const title = String(formData.get("title") ?? "").trim();
  const examType = String(formData.get("examType") ?? "") as ExamType;
  if (!title || !examType) throw new Error("الرجاء إدخال عنوان الامتحان ونوعه");

  const passingScore = Number(formData.get("passingScore") ?? 60);
  const maxAttempts = Number(formData.get("maxAttempts") ?? 1);
  const timeLimitRaw = formData.get("timeLimitMinutes");
  const timeLimitMinutes = timeLimitRaw ? Number(timeLimitRaw) : null;
  const questionCountRaw = formData.get("questionCount");
  const questionCount = questionCountRaw ? Number(questionCountRaw) : null;
  const randomizeQuestions = formData.get("randomizeQuestions") === "on";
  const availableFromRaw = String(formData.get("availableFrom") ?? "");
  const availableToRaw = String(formData.get("availableTo") ?? "");

  const quiz = await prisma.quiz.create({
    data: {
      title,
      examType,
      passingScore,
      maxAttempts,
      timeLimitMinutes,
      questionCount,
      randomizeQuestions,
      availableFrom: availableFromRaw ? new Date(availableFromRaw) : null,
      availableTo: availableToRaw ? new Date(availableToRaw) : null,
    },
  });

  revalidatePath("/teacher/exams");
  redirect(`/teacher/exams/${quiz.id}`);
}

export async function createLessonQuiz(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const lessonId = String(formData.get("lessonId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!lessonId || !title) {
    throw new Error("الرجاء اختيار الدرس وإدخال عنوان الاختبار");
  }

  const existing = await prisma.quiz.findFirst({
    where: { lessonId, examType: "LESSON_QUIZ" },
  });
  if (existing) throw new Error("يوجد بالفعل اختبار لهذا الدرس");

  const passingScore = Number(formData.get("passingScore") ?? 60);
  const maxAttempts = Number(formData.get("maxAttempts") ?? 3);

  const quiz = await prisma.quiz.create({
    data: {
      lessonId,
      examType: "LESSON_QUIZ",
      title,
      passingScore,
      maxAttempts,
    },
  });

  revalidatePath("/teacher/exams");
  redirect(`/teacher/exams/${quiz.id}`);
}

export async function addQuestionToExam(quizId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const questionId = String(formData.get("questionId") ?? "");
  const points = Number(formData.get("points") ?? 1);
  if (!questionId) throw new Error("الرجاء اختيار سؤال");

  const exists = await prisma.quizQuestion.findUnique({
    where: { quizId_questionId: { quizId, questionId } },
  });
  if (exists) throw new Error("هذا السؤال مضاف بالفعل لهذا الامتحان");

  const order = await prisma.quizQuestion.count({ where: { quizId } });
  await prisma.quizQuestion.create({
    data: { quizId, questionId, points, order },
  });

  revalidatePath(`/teacher/exams/${quizId}`);
}

export async function removeQuestionFromExam(quizId: string, quizQuestionId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.quizQuestion.delete({ where: { id: quizQuestionId } });

  revalidatePath(`/teacher/exams/${quizId}`);
}
