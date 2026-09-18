import { prisma } from "@/lib/prisma";
import type { QuestionType } from "@prisma/client";

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function createQuestion(overrides: {
  type?: QuestionType;
  correctAnswer?: unknown;
} = {}) {
  return prisma.question.create({
    data: {
      type: overrides.type ?? "SINGLE_CHOICE",
      prompt: unique("question"),
      options: ["A", "B", "C"],
      correctAnswer: (overrides.correctAnswer ?? "A") as never,
    },
  });
}

export async function createQuiz(overrides: {
  lessonId?: string;
  passingScore?: number;
  maxAttempts?: number;
  failedAttemptConsumesAttempt?: boolean;
  questionIds?: string[];
} = {}) {
  const quiz = await prisma.quiz.create({
    data: {
      lessonId: overrides.lessonId,
      title: unique("quiz"),
      passingScore: overrides.passingScore ?? 60,
      maxAttempts: overrides.maxAttempts ?? 3,
      failedAttemptConsumesAttempt: overrides.failedAttemptConsumesAttempt ?? true,
    },
  });

  if (overrides.questionIds) {
    await prisma.$transaction(
      overrides.questionIds.map((questionId, index) =>
        prisma.quizQuestion.create({
          data: { quizId: quiz.id, questionId, order: index, points: 1 },
        }),
      ),
    );
  }

  return quiz;
}
