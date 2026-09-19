"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import {
  CAREER_QUIZ_QUESTIONS,
  submitCareerExplorationQuiz,
  type CareerQuizAnswers,
} from "@/lib/business/career-guidance";

export async function submitQuiz(formData: FormData) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);
  const studentId = session.user.studentProfileId!;

  const answers = {} as CareerQuizAnswers;
  for (const question of CAREER_QUIZ_QUESTIONS) {
    const value = formData.get(question.id);
    if (!value) throw new Error("الرجاء الإجابة على كل الأسئلة");
    answers[question.id] = String(value) as CareerQuizAnswers[string];
  }

  await submitCareerExplorationQuiz(prisma, { studentId, answers });

  revalidatePath("/student/career-guidance");
}
