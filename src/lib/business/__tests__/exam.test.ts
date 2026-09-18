import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import { createQuestion, createQuiz } from "@/test/factories-quiz";
import {
  getQuestionsForAttempt,
  startQuizAttempt,
  submitQuizAttempt,
} from "@/lib/business/quiz";

beforeEach(async () => {
  await resetDatabase();
});

async function createQuestionSet(count: number) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push(await createQuestion({ correctAnswer: "A" }));
  }
  return questions;
}

describe("randomized exam question selection", () => {
  it("serves exactly questionCount questions out of a larger bank", async () => {
    const student = await createStudent();
    const questions = await createQuestionSet(10);
    const quiz = await createQuiz({
      passingScore: 50,
      questionCount: 4,
      questionIds: questions.map((q) => q.id),
    });

    const attempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });

    const assigned = await getQuestionsForAttempt(prisma, attempt.id);
    expect(assigned).toHaveLength(4);

    const assignedIds = new Set(assigned.map((q) => q.id));
    expect(assignedIds.size).toBe(4);
    for (const id of assignedIds) {
      expect(questions.map((q) => q.id)).toContain(id);
    }
  });

  it("computes the percentage only over the assigned subset, not the whole bank", async () => {
    const student = await createStudent();
    const questions = await createQuestionSet(10); // all correctAnswer "A"
    const quiz = await createQuiz({
      passingScore: 50,
      questionCount: 4,
      questionIds: questions.map((q) => q.id),
    });

    const attempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    const assigned = await getQuestionsForAttempt(prisma, attempt.id);

    const graded = await submitQuizAttempt(prisma, {
      attemptId: attempt.id,
      answers: assigned.map((q) => ({ questionId: q.id, studentAnswer: "A" })),
    });

    // All 4 assigned questions answered correctly => 100%, not 40% (4/10).
    expect(graded.percentage).toBe(100);
    expect(graded.passed).toBe(true);
  });

  it("rejects an answer for a question outside the attempt's assigned subset", async () => {
    const student = await createStudent();
    const questions = await createQuestionSet(10);
    const quiz = await createQuiz({
      passingScore: 50,
      questionCount: 4,
      questionIds: questions.map((q) => q.id),
    });

    const attempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    const assigned = await getQuestionsForAttempt(prisma, attempt.id);
    const assignedIds = new Set(assigned.map((q) => q.id));
    const outsider = questions.find((q) => !assignedIds.has(q.id))!;

    await expect(
      submitQuizAttempt(prisma, {
        attemptId: attempt.id,
        answers: [{ questionId: outsider.id, studentAnswer: "A" }],
      }),
    ).rejects.toThrow(/not part of this attempt/);
  });

  it("serves all questions when questionCount is not set (no randomization)", async () => {
    const student = await createStudent();
    const questions = await createQuestionSet(5);
    const quiz = await createQuiz({
      passingScore: 50,
      questionIds: questions.map((q) => q.id),
    });

    const attempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    const assigned = await getQuestionsForAttempt(prisma, attempt.id);
    expect(assigned).toHaveLength(5);
  });
});

describe("exam availability window", () => {
  it("rejects starting an attempt before availableFrom", async () => {
    const student = await createStudent();
    const question = await createQuestion({ correctAnswer: "A" });
    const quiz = await prisma.quiz.create({
      data: {
        title: "امتحان مؤجل",
        examType: "MONTHLY",
        availableFrom: new Date(Date.now() + 1000 * 60 * 60),
        quizQuestions: { create: [{ questionId: question.id, order: 0, points: 1 }] },
      },
    });

    await expect(
      startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id }),
    ).rejects.toThrow(/not open yet/);
  });

  it("rejects starting an attempt after availableTo", async () => {
    const student = await createStudent();
    const question = await createQuestion({ correctAnswer: "A" });
    const quiz = await prisma.quiz.create({
      data: {
        title: "امتحان منتهي",
        examType: "MONTHLY",
        availableTo: new Date(Date.now() - 1000 * 60 * 60),
        quizQuestions: { create: [{ questionId: question.id, order: 0, points: 1 }] },
      },
    });

    await expect(
      startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id }),
    ).rejects.toThrow(/no longer available/);
  });

  it("allows starting an attempt within the availability window", async () => {
    const student = await createStudent();
    const question = await createQuestion({ correctAnswer: "A" });
    const quiz = await prisma.quiz.create({
      data: {
        title: "امتحان متاح",
        examType: "WEEKLY",
        availableFrom: new Date(Date.now() - 1000 * 60 * 60),
        availableTo: new Date(Date.now() + 1000 * 60 * 60),
        quizQuestions: { create: [{ questionId: question.id, order: 0, points: 1 }] },
      },
    });

    const attempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    expect(attempt.status).toBe("IN_PROGRESS");
  });
});
