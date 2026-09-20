import type { PrismaClient, QuestionType } from "@prisma/client";
import { notify } from "@/lib/business/notifications";
import { allRequiredExperimentsCompleted } from "@/lib/business/experiment";
import { evaluateAchievementsForStudent } from "@/lib/business/achievements";
import { issueCertificateIfEligible } from "@/lib/business/certificates";
import {
  getPlatformSetting,
  PLATFORM_SETTING_KEYS,
} from "@/lib/platform-settings";

// Slack for the client's own auto-submit call landing slightly after the
// deadline (network latency) — not extra thinking time, since the client
// timer already fired before this request was sent.
const SUBMIT_GRACE_SECONDS = 20;

function isAutoGradable(type: QuestionType) {
  return type !== "ESSAY" && type !== "SHORT_ANSWER";
}

/**
 * MATCHING answers are positional (answers[i] pairs with options[i], per the
 * question-bank editor and exam UI) and must be compared index-by-index —
 * sorting would let any permutation of the correct value set score as fully
 * correct even when paired with the wrong item. Every other multi-value type
 * (MULTIPLE_CHOICE) is a true set, so it's compared order-independently.
 */
function answersMatch(type: QuestionType, correct: unknown, given: unknown): boolean {
  if (type === "MATCHING") {
    if (!Array.isArray(correct) || !Array.isArray(given)) return false;
    if (correct.length !== given.length) return false;
    return correct.every((value, index) => value === given[index]);
  }
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

function attemptDeadlineMs(
  attempt: { startedAt: Date },
  quiz: { timeLimitMinutes: number | null },
): number | null {
  if (quiz.timeLimitMinutes == null) return null;
  return (
    attempt.startedAt.getTime() +
    quiz.timeLimitMinutes * 60_000 +
    SUBMIT_GRACE_SECONDS * 1000
  );
}

/**
 * Force-finalizes an abandoned attempt (never submitted by the client) as a
 * full failure — every assigned question graded wrong/zero — so a student
 * can never gain extra thinking time, and can never dodge maxAttempts, by
 * simply leaving a browser tab open past the deadline instead of submitting.
 * This is server-initiated, so it bypasses submitQuizAttempt's client-facing
 * "must cover every question" validation (there is nothing to validate).
 */
async function forceExpireAttempt(
  prisma: PrismaClient,
  attemptId: string,
) {
  const attempt = await prisma.quizAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { quiz: { include: { quizQuestions: true } } },
  });
  if (attempt.status !== "IN_PROGRESS") return attempt;

  const allowedIds = attempt.selectedQuestionIds as string[] | null;
  const allowedQuizQuestions = allowedIds
    ? attempt.quiz.quizQuestions.filter((qq) => allowedIds.includes(qq.questionId))
    : attempt.quiz.quizQuestions;

  await prisma.$transaction(
    allowedQuizQuestions.map((qq) =>
      prisma.quizAnswer.create({
        data: {
          attemptId: attempt.id,
          questionId: qq.questionId,
          studentAnswer: null as never,
          isCorrect: false,
          pointsAwarded: 0,
        },
      }),
    ),
  );

  await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  return finalizeAttemptIfFullyGraded(prisma, attempt.id);
}

/**
 * A student may only have one IN_PROGRESS attempt per quiz at a time — this
 * closes the "start several attempts, preview each one's random question
 * subset, and only ever submit the easiest one" loophole (unsubmitted
 * attempts never counted against maxAttempts). An attempt whose own deadline
 * (time limit, or a generous abandoned-attempt fallback for untimed quizzes)
 * has already passed is auto-expired as a failure rather than blocking the
 * student forever.
 */
async function reclaimStaleInProgressAttempt(
  prisma: PrismaClient,
  params: { quizId: string; studentId: string },
) {
  const inProgress = await prisma.quizAttempt.findFirst({
    where: { quizId: params.quizId, studentId: params.studentId, status: "IN_PROGRESS" },
    include: { quiz: true },
  });
  if (!inProgress) return;

  const timedDeadline = attemptDeadlineMs(inProgress, inProgress.quiz);
  let deadlineMs = timedDeadline;
  if (deadlineMs == null) {
    const abandonedHours = await getPlatformSetting<number>(
      PLATFORM_SETTING_KEYS.QUIZ_ABANDONED_ATTEMPT_HOURS,
    );
    deadlineMs = inProgress.startedAt.getTime() + abandonedHours * 60 * 60_000;
  }

  if (Date.now() > deadlineMs) {
    await forceExpireAttempt(prisma, inProgress.id);
    return;
  }

  throw new Error("You already have an attempt in progress for this quiz");
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

  if (quiz.examType === "LESSON_QUIZ" && quiz.lessonId) {
    // The lesson-sequence gate (canAccessLesson) is otherwise only enforced
    // when rendering the video page — without this check here, a student
    // who obtains a later lesson's quizId (guessed/shared/found in the
    // network tab) could start and pass it directly, which still unlocks
    // its successors, short-circuiting the entire prerequisite chain.
    const lessonAccess = await canAccessLesson(prisma, {
      studentId: params.studentId,
      lessonId: quiz.lessonId,
    });
    if (!lessonAccess.allowed) {
      throw new Error("Complete the previous lesson before taking this quiz");
    }

    const ready = await allRequiredExperimentsCompleted(prisma, {
      lessonId: quiz.lessonId,
      studentId: params.studentId,
    });
    if (!ready) {
      throw new Error("Complete the required experiments for this lesson first");
    }
  }

  // Only one attempt may be IN_PROGRESS at a time — otherwise a student could
  // start several attempts (each fixing a fresh random question subset),
  // preview each one, and only ever submit the easiest, since an unsubmitted
  // attempt never counted against maxAttempts.
  await reclaimStaleInProgressAttempt(prisma, params);

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
    // A concurrent submit already won the race (the QuizAnswer @@unique
    // constraint would otherwise throw a raw P2002 from inside the
    // transaction below) — report the same outcome either way rather than
    // surfacing a 500 to the loser of the race.
    return finalizeAttemptIfFullyGraded(prisma, attempt.id);
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

  // Every assigned question must be present in the submission (a blank
  // answer is fine — the real exam UI always sends one entry per question,
  // even unanswered ones) — otherwise a student could omit hard or
  // ESSAY/SHORT_ANSWER questions entirely to shrink `totalPoints` and both
  // inflate their percentage and dodge manual grading.
  const submittedIds = new Set(params.answers.map((a) => a.questionId));
  const missingIds = [...allowedIdSet].filter((id) => !submittedIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      "You must submit an answer entry for every assigned question (a blank answer is fine, omitting the question is not)",
    );
  }

  // No server-side clock trust in the client's own countdown timer: if the
  // deadline (time limit, and/or the exam's availability window) has
  // already passed, the submission is graded as a full failure regardless
  // of its content — a student cannot buy extra thinking time by calling
  // this action directly instead of waiting for the client's auto-submit.
  const now = new Date();
  const deadlineMs = attemptDeadlineMs(attempt, attempt.quiz);
  const expired =
    (deadlineMs != null && now.getTime() > deadlineMs) ||
    (attempt.quiz.availableTo != null && now > attempt.quiz.availableTo);

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
      const isCorrect = expired
        ? false
        : autoGradable
          ? answersMatch(question!.type, question!.correctAnswer, studentAnswer)
          : null;

      return prisma.quizAnswer.create({
        data: {
          attemptId: attempt.id,
          questionId,
          studentAnswer: studentAnswer as never,
          isCorrect,
          pointsAwarded: expired ? 0 : autoGradable ? (isCorrect ? maxPoints : 0) : null,
        },
      });
    }),
  );

  await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: { status: "SUBMITTED", submittedAt: now },
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
  const existing = await prisma.quizAnswer.findUniqueOrThrow({
    where: { id: params.answerId },
    include: { attempt: { include: { quiz: { include: { quizQuestions: true } } } } },
  });
  const maxPoints =
    existing.attempt.quiz.quizQuestions.find((qq) => qq.questionId === existing.questionId)
      ?.points ?? 1;
  // The client form's min="0" is a UI hint only — clamp server-side so a
  // crafted request can't award negative points or more than the question
  // is actually configured to be worth.
  const clampedPoints = Math.min(Math.max(params.pointsAwarded, 0), maxPoints);

  const answer = await prisma.quizAnswer.update({
    where: { id: params.answerId },
    data: {
      pointsAwarded: clampedPoints,
      isCorrect: clampedPoints > 0,
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

  // Lesson completion is recorded BEFORE achievements are evaluated so a
  // LESSONS_COMPLETED-based achievement can fire on the very same trigger
  // that completes the lesson, rather than lagging until the next trigger.
  if (passed && attempt.quiz.lessonId) {
    await markLessonCompletedAndUnlockNext(prisma, {
      studentId: attempt.studentId,
      lessonId: attempt.quiz.lessonId,
    });
  }

  if (passed) {
    await evaluateAchievementsForStudent(prisma, attempt.studentId);
  }

  return updated;
}

async function markLessonCompletedAndUnlockNext(
  prisma: PrismaClient,
  params: { studentId: string; lessonId: string },
) {
  // Idempotency guard: a student can retake and re-pass a quiz (maxAttempts
  // may allow it even after a pass) — without this check, every re-pass
  // would re-send the "next lesson unlocked" notification and could
  // downgrade an already-completed next lesson's status back to
  // IN_PROGRESS below.
  const existingProgress = await prisma.lessonProgress.findUnique({
    where: {
      studentId_lessonId: { studentId: params.studentId, lessonId: params.lessonId },
    },
  });
  if (existingProgress?.status === "COMPLETED") {
    return;
  }

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

  const completedLesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: params.lessonId },
    select: { courseId: true },
  });
  await issueCertificateIfEligible(prisma, {
    studentId: params.studentId,
    courseId: completedLesson.courseId,
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
