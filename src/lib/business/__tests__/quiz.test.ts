import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createLesson, createStudent } from "@/test/factories";
import { createQuestion, createQuiz } from "@/test/factories-quiz";
import {
  canAccessLesson,
  gradeManualAnswer,
  startQuizAttempt,
  submitQuizAttempt,
} from "@/lib/business/quiz";

beforeEach(async () => {
  await resetDatabase();
});

describe("quiz grading and lesson unlocking", () => {
  it("passing the quiz unlocks the next lesson", async () => {
    const student = await createStudent();
    const lessonA = await createLesson();
    const lessonB = await createLesson({
      requiredPreviousLessonId: lessonA.id,
    });
    const question = await createQuestion({ correctAnswer: "A" });
    const quiz = await createQuiz({
      lessonId: lessonA.id,
      passingScore: 60,
      questionIds: [question.id],
    });

    const before = await canAccessLesson(prisma, {
      studentId: student.id,
      lessonId: lessonB.id,
    });
    expect(before.allowed).toBe(false);

    const attempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    await submitQuizAttempt(prisma, {
      attemptId: attempt.id,
      answers: [{ questionId: question.id, studentAnswer: "A" }],
    });

    const after = await canAccessLesson(prisma, {
      studentId: student.id,
      lessonId: lessonB.id,
    });
    expect(after.allowed).toBe(true);
  });

  it("failing the quiz keeps the next lesson locked", async () => {
    const student = await createStudent();
    const lessonA = await createLesson();
    const lessonB = await createLesson({
      requiredPreviousLessonId: lessonA.id,
    });
    const question = await createQuestion({ correctAnswer: "A" });
    const quiz = await createQuiz({
      lessonId: lessonA.id,
      passingScore: 60,
      questionIds: [question.id],
    });

    const attempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    const graded = await submitQuizAttempt(prisma, {
      attemptId: attempt.id,
      answers: [{ questionId: question.id, studentAnswer: "B" }],
    });

    expect(graded.passed).toBe(false);
    const decision = await canAccessLesson(prisma, {
      studentId: student.id,
      lessonId: lessonB.id,
    });
    expect(decision.allowed).toBe(false);
  });

  it("manual grading of an essay question can flip the attempt to passed", async () => {
    const student = await createStudent();
    const lessonA = await createLesson();
    const question = await createQuestion({
      type: "ESSAY",
      correctAnswer: null,
    });
    const quiz = await createQuiz({
      lessonId: lessonA.id,
      passingScore: 50,
      questionIds: [question.id],
    });

    const attempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    const afterSubmit = await submitQuizAttempt(prisma, {
      attemptId: attempt.id,
      answers: [{ questionId: question.id, studentAnswer: "my essay answer" }],
    });
    // Ungraded essay means the attempt cannot be finalized yet.
    expect(afterSubmit.status).toBe("SUBMITTED");
    expect(afterSubmit.passed).toBeNull();

    const savedAnswer = await prisma.quizAnswer.findFirstOrThrow({
      where: { attemptId: attempt.id },
    });
    await gradeManualAnswer(prisma, {
      answerId: savedAnswer.id,
      pointsAwarded: 1,
      reviewerId: "teacher-1",
    });

    const finalAttempt = await prisma.quizAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(finalAttempt.status).toBe("GRADED");
    expect(finalAttempt.passed).toBe(true);
  });

  it("enforces the maximum attempts limit", async () => {
    const student = await createStudent();
    const lessonA = await createLesson();
    const question = await createQuestion({ correctAnswer: "A" });
    const quiz = await createQuiz({
      lessonId: lessonA.id,
      maxAttempts: 2,
      questionIds: [question.id],
    });

    for (let i = 0; i < 2; i++) {
      const attempt = await startQuizAttempt(prisma, {
        quizId: quiz.id,
        studentId: student.id,
      });
      await submitQuizAttempt(prisma, {
        attemptId: attempt.id,
        answers: [{ questionId: question.id, studentAnswer: "B" }], // always fails
      });
    }

    await expect(
      startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id }),
    ).rejects.toThrow(/attempts/i);
  });
});
