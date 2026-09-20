"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import type { QuestionDifficulty, QuestionType } from "@prisma/client";
import { isForeignKeyConstraintError } from "@/lib/prisma-errors";

const MANUALLY_GRADED_TYPES: QuestionType[] = ["SHORT_ANSWER", "ESSAY"];

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function createQuestionBank(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("اسم بنك الأسئلة مطلوب");

  await prisma.questionBank.create({
    data: {
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      teacherId: session.user.id,
    },
  });

  revalidatePath("/teacher/question-bank");
}

export async function createQuestion(bankId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const type = String(formData.get("type") ?? "") as QuestionType;
  const prompt = String(formData.get("prompt") ?? "").trim();
  const difficulty = String(formData.get("difficulty") ?? "MEDIUM") as QuestionDifficulty;
  const tags = parseCsv(String(formData.get("tags") ?? ""));
  if (!type || !prompt) throw new Error("الرجاء إدخال نوع السؤال ونصه");

  const optionsList = parseCsv(String(formData.get("options") ?? ""));
  const correctRaw = String(formData.get("correctAnswer") ?? "").trim();

  let options: string[] | null = null;
  let correctAnswer: unknown = "";

  if (MANUALLY_GRADED_TYPES.includes(type)) {
    options = null;
    correctAnswer = ""; // ungraded automatically; a teacher scores it manually after submission
  } else if (type === "MULTIPLE_CHOICE") {
    if (optionsList.length < 2) throw new Error("الرجاء إدخال خيارين على الأقل");
    options = optionsList;
    correctAnswer = parseCsv(correctRaw);
  } else if (type === "MATCHING") {
    if (optionsList.length < 2) throw new Error("الرجاء إدخال عناصر المطابقة");
    options = optionsList;
    correctAnswer = parseCsv(correctRaw); // positional: matches[i] pairs with options[i]
  } else {
    // SINGLE_CHOICE / TRUE_FALSE
    if (optionsList.length < 2) throw new Error("الرجاء إدخال خيارين على الأقل");
    options = optionsList;
    correctAnswer = correctRaw;
  }

  await prisma.question.create({
    data: {
      bankId,
      type,
      prompt,
      options: options as never,
      correctAnswer: correctAnswer as never,
      difficulty,
      tags,
    },
  });

  revalidatePath(`/teacher/question-bank/${bankId}`);
}

export async function deleteQuestion(bankId: string, questionId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  try {
    await prisma.question.delete({ where: { id: questionId } });
  } catch (error) {
    // QuizQuestion.questionId and QuizAnswer.questionId are ON DELETE
    // RESTRICT — a question that has ever appeared on a quiz or been
    // answered cannot be hard-deleted. A clean, actionable error beats
    // letting Postgres's raw FK-violation crash the server action.
    if (isForeignKeyConstraintError(error)) {
      throw new Error(
        "لا يمكن حذف هذا السؤال لأنه مستخدم في امتحان أو تمت الإجابة عليه بالفعل",
      );
    }
    throw error;
  }

  revalidatePath(`/teacher/question-bank/${bankId}`);
}
