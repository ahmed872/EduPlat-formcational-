import type { PrismaClient, QuestionType } from "@prisma/client";
import { notify } from "@/lib/business/notifications";

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

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function startQuizAttempt(
  prisma: PrismaClient,
  params: { quizId: string; studentId: string },
) {
  const quiz = await prisma.quiz.findUniqueOrThrow({
    where: { id: params.quizId },
    include: { quizQuestions: true },
  });

  const now = new Date();
  if (quiz.availableFrom && now < quiz.availableFrom) {
    throw new Error("This exam is not open yet");
  }
  if (quiz.availableTo && now > quiz.availableTo) {
    throw new Error("This exam is no longer available");
  }

  const { allowed, nextAttemptNumber } = await canStartNewAttempt(prisma, params);
  if (!allowed) {
    throw new Error("Maximum quiz attempts reached");
  }

  // A random subset is fixed at attempt-start time, not re-rolled on every
  // fetch, so the student answers the same questions they were shown.
  const allQuestionIds = quiz.quizQuestions.map((qq) => qq.questionId);
  const selectedQuestionIds =
    quiz.questionCount && quiz.questionCount < allQuestionIds.length
      ? shuffled(allQuestionIds).slice(0, quiz.questionCount)
      : null;

  return prisma.quizAttempt.create({
    data: {
      quizId: params.quizId,
      studentId: params.studentId,
      attemptNumber: nextAttemptNumber,
      selectedQuestionIds: selectedQuestionIds as never,
    },
  });
}

/**
 * The exact set of questions a student must be shown/answer for this
 * attempt — either the random subset fixed at startQuizAttempt(), or every
 * configured question if the quiz isn't using questionCount. Never
 * includes correctAnswer. Order is shuffled when randomizeQuestions is set.
 */
export async function getQuestionsForAttempt(
  prisma: PrismaClient,
  attemptId: string,
) {
  const attempt = await prisma.quizAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      quiz: { include: { quizQuestions: { include: { question: true }, orderBy: { order: "asc" } } } },
    },
  });

  const allowedIds = attempt.selectedQuestionIds as string[] | null;
  let quizQuestions = attempt.quiz.quizQuestions;
  if (allowedIds) {
    const allowedSet = new Set(allowedIds);
    quizQuestions = quizQuestions.filter((qq) => allowedSet.has(qq.questionId));
  }

  const questions = quizQuestions.map((qq) => ({
    id: qq.question.id,
    type: qq.question.type,
    prompt: qq.question.prompt,
    options: qq.question.options,
    points: qq.points,
  }));

  return attempt.quiz.randomizeQuestions ? shuffled(questions) : questions;
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

  const allowedIds = attempt.selectedQuestionIds as string[] | null;
  const allowedQuizQuestions = allowedIds
    ? attempt.quiz.quizQuestions.filter((qq) => allowedIds.includes(qq.questionId))
    : attempt.quiz.quizQuestions;
  const allowedIdSet = new Set(allowedQuizQuestions.map((qq) => qq.questionId));

  const disallowed = params.answers.find((a) => !allowedIdSet.has(a.questionId));
  if (disallowed) {
    throw new Error(
      `Question ${disallowed.questionId} is not part of this attempt's assigned questions`,
    );
  }

  const pointsByQuestion = new Map(
    allowedQuizQuestions.map((qq) => [qq.questionId, qq.points]),
  );
  const questionById = new Map(
    allowedQuizQuestions.map((qq) => [qq.questionId, qq.question]),
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

  // Total is based on the questions actually answered in THIS attempt, not
  // every question configured on the quiz — required for correctness once
  // Quiz.questionCount serves a random subset (a student never sees, and
  // must never be scored against, questions outside their own subset).
  const maxPointsByQuestion = new Map(
    attempt.quiz.quizQuestions.map((qq) => [qq.questionId, qq.points]),
  );
  const totalPoints = attempt.answers.reduce(
    (sum, answer) => sum + (maxPointsByQuestion.get(answer.questionId) ?? 0),
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

  if (nextLessons.length > 0) {
    const student = await prisma.studentProfile.findUnique({
      where: { id: params.studentId },
      select: { userId: true },
    });
    if (student) {
      await notify(prisma, {
        userId: student.userId,
        type: "LESSON_UNLOCKED",
        title: "تم فتح درس جديد",
        body: `يمكنك الآن مشاهدة: ${nextLessons.map((l) => l.title).join("، ")}`,
        metadata: { lessonIds: nextLessons.map((l) => l.id) },
      });
    }
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
