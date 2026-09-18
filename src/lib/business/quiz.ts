import type { PrismaClient, QuestionType } from "@prisma/client";

function isAutoGradable(type: QuestionType) {
  return type !== "ESSAY" && type !== "SHORT_ANSWER";
}

function answersMatch(correct: unknown, given: unknown): boolean {
  if (Array.isArray(correct) && Array.isArray(given)) {
    const sortedCorrect = [...correct].sort();
    const sortedGiven = [...given].sort();
    return JSON.stringify(sortedCorrect) === JSON.stringify(sortedGiven);
  }
  return JSON.stringify(correct) === JSON.stringify(given);
}

export async function canStartNewAttempt(
  prisma: PrismaClient,
  params: { quizId: string; studentId: string },
): Promise<{ allowed: boolean; nextAttemptNumber: number }> {
  const quiz = await prisma.quiz.findUniqueOrThrow({
    where: { id: params.quizId },
  });
  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId: params.quizId, studentId: params.studentId },
    orderBy: { attemptNumber: "desc" },
  });

  const countingAttempts = attempts.filter(
    (attempt) =>
      attempt.status !== "IN_PROGRESS" &&
      (attempt.passed === true || quiz.failedAttemptConsumesAttempt),
  );

  const nextAttemptNumber = (attempts[0]?.attemptNumber ?? 0) + 1;
  return {
    allowed: countingAttempts.length < quiz.maxAttempts,
    nextAttemptNumber,
  };
}

export async function startQuizAttempt(
  prisma: PrismaClient,
  params: { quizId: string; studentId: string },
) {
  const { allowed, nextAttemptNumber } = await canStartNewAttempt(prisma, params);
  if (!allowed) {
    throw new Error("Maximum quiz attempts reached");
  }
  return prisma.quizAttempt.create({
    data: {
      quizId: params.quizId,
      studentId: params.studentId,
      attemptNumber: nextAttemptNumber,
    },
  });
}

/**
 * Grades whatever is objectively gradable immediately; ESSAY/SHORT_ANSWER
 * questions are left with isCorrect = null until a teacher reviews them
 * (see gradeManualAnswer). The attempt only becomes fully "passed/failed"
 * once every question has a verdict.
 */
export async function submitQuizAttempt(
  prisma: PrismaClient,
  params: {
    attemptId: string;
    answers: Array<{ questionId: string; studentAnswer: unknown }>;
  },
) {
  const attempt = await prisma.quizAttempt.findUniqueOrThrow({
    where: { id: params.attemptId },
    include: { quiz: { include: { quizQuestions: { include: { question: true } } } } },
  });
  if (attempt.status !== "IN_PROGRESS") {
    throw new Error("Attempt already submitted");
  }

  const pointsByQuestion = new Map(
    attempt.quiz.quizQuestions.map((qq) => [qq.questionId, qq.points]),
  );
  const questionById = new Map(
    attempt.quiz.quizQuestions.map((qq) => [qq.questionId, qq.question]),
  );

  await prisma.$transaction(
    params.answers.map(({ questionId, studentAnswer }) => {
      const question = questionById.get(questionId);
      const maxPoints = pointsByQuestion.get(questionId) ?? 1;
      const autoGradable = question ? isAutoGradable(question.type) : false;
      const isCorrect = autoGradable
        ? answersMatch(question!.correctAnswer, studentAnswer)
        : null;

      return prisma.quizAnswer.create({
        data: {
          attemptId: attempt.id,
          questionId,
          studentAnswer: studentAnswer as never,
          isCorrect,
          pointsAwarded: autoGradable ? (isCorrect ? maxPoints : 0) : null,
        },
      });
    }),
  );

  await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  return finalizeAttemptIfFullyGraded(prisma, attempt.id);
}

export async function gradeManualAnswer(
  prisma: PrismaClient,
  params: {
    answerId: string;
    pointsAwarded: number;
    feedback?: string;
    reviewerId: string;
  },
) {
  const answer = await prisma.quizAnswer.update({
    where: { id: params.answerId },
    data: {
      pointsAwarded: params.pointsAwarded,
      isCorrect: params.pointsAwarded > 0,
      manualFeedback: params.feedback,
      reviewedAt: new Date(),
      reviewedById: params.reviewerId,
    },
  });

  await finalizeAttemptIfFullyGraded(prisma, answer.attemptId);
  return answer;
}

/**
 * Recomputes score/percentage/passed once every answer has a verdict, and
 * unlocks the next lesson when the attempt passes. Safe to call after every
 * grading action (auto or manual) — it is a no-op while answers remain
 * ungraded.
 */
export async function finalizeAttemptIfFullyGraded(
  prisma: PrismaClient,
  attemptId: string,
) {
  const attempt = await prisma.quizAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      answers: true,
      quiz: { include: { quizQuestions: true, lesson: true } },
    },
  });

  const stillPending = attempt.answers.some((a) => a.isCorrect === null);
  if (stillPending) return attempt;

  const maxPointsByQuestion = new Map(
    attempt.quiz.quizQuestions.map((qq) => [qq.questionId, qq.points]),
  );
  const totalPoints = attempt.quiz.quizQuestions.reduce(
    (sum, qq) => sum + qq.points,
    0,
  );
  const earnedPoints = attempt.answers.reduce(
    (sum, answer) => sum + (answer.pointsAwarded ?? 0),
    0,
  );
  const percentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
  const passed = percentage >= attempt.quiz.passingScore;

  const updated = await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "GRADED",
      score: earnedPoints,
      percentage,
      passed,
    },
  });

  if (passed && attempt.quiz.lessonId) {
    await markLessonCompletedAndUnlockNext(prisma, {
      studentId: attempt.studentId,
      lessonId: attempt.quiz.lessonId,
    });
  }

  void maxPointsByQuestion; // kept for readability of the points computation above
  return updated;
}

async function markLessonCompletedAndUnlockNext(
  prisma: PrismaClient,
  params: { studentId: string; lessonId: string },
) {
  await prisma.lessonProgress.upsert({
    where: {
      studentId_lessonId: {
        studentId: params.studentId,
        lessonId: params.lessonId,
      },
    },
    create: {
      studentId: params.studentId,
      lessonId: params.lessonId,
      status: "COMPLETED",
      quizPassed: true,
      completedAt: new Date(),
    },
    update: { status: "COMPLETED", quizPassed: true, completedAt: new Date() },
  });

  const nextLessons = await prisma.lesson.findMany({
    where: { requiredPreviousLessonId: params.lessonId },
  });

  for (const nextLesson of nextLessons) {
    await prisma.lessonProgress.upsert({
      where: {
        studentId_lessonId: {
          studentId: params.studentId,
          lessonId: nextLesson.id,
        },
      },
      create: {
        studentId: params.studentId,
        lessonId: nextLesson.id,
        status: "IN_PROGRESS",
      },
      update: {
        status: "IN_PROGRESS",
      },
    });
  }
}

export type LessonAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "PREVIOUS_LESSON_NOT_COMPLETED" };

export async function canAccessLesson(
  prisma: PrismaClient,
  params: { studentId: string; lessonId: string },
): Promise<LessonAccessDecision> {
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: params.lessonId },
  });

  if (lesson.isFree || !lesson.requiredPreviousLessonId) {
    return { allowed: true };
  }

  const previousProgress = await prisma.lessonProgress.findUnique({
    where: {
      studentId_lessonId: {
        studentId: params.studentId,
        lessonId: lesson.requiredPreviousLessonId,
      },
    },
  });

  if (previousProgress?.status === "COMPLETED" && previousProgress.quizPassed) {
    return { allowed: true };
  }

  return { allowed: false, reason: "PREVIOUS_LESSON_NOT_COMPLETED" };
}
