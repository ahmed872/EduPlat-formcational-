import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createEntitlement, createLesson, createStudent, createExperiment } from "@/test/factories";
import { createQuiz } from "@/test/factories-quiz";
import {
  allRequiredExperimentsCompleted,
  completeExperimentAttempt,
  getExperimentsWithStatus,
  startExperimentAttempt,
} from "@/lib/business/experiment";
import { startQuizAttempt } from "@/lib/business/quiz";

beforeEach(async () => {
  await resetDatabase();
});

describe("experiment status and completion", () => {
  it("reports an experiment as not completed before any attempt", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const experiment = await createExperiment({ lessonId: lesson.id });

    const statuses = await getExperimentsWithStatus(prisma, {
      lessonId: lesson.id,
      studentId: student.id,
    });

    expect(statuses).toHaveLength(1);
    expect(statuses[0].completed).toBe(false);
    expect(statuses[0].experiment.id).toBe(experiment.id);
  });

  it("marks an experiment completed once the attempt is finished", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const experiment = await createExperiment({ lessonId: lesson.id });

    const attempt = await startExperimentAttempt(prisma, {
      experimentId: experiment.id,
      studentId: student.id,
    });
    await completeExperimentAttempt(prisma, {
      attemptId: attempt.id,
      studentId: student.id,
      resultJson: { steps: ["1"] },
    });

    const statuses = await getExperimentsWithStatus(prisma, {
      lessonId: lesson.id,
      studentId: student.id,
    });
    expect(statuses[0].completed).toBe(true);
  });

  it("reuses an in-progress attempt instead of creating a new row", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const experiment = await createExperiment({ lessonId: lesson.id });

    const first = await startExperimentAttempt(prisma, {
      experimentId: experiment.id,
      studentId: student.id,
    });
    const second = await startExperimentAttempt(prisma, {
      experimentId: experiment.id,
      studentId: student.id,
    });

    expect(second.id).toBe(first.id);
  });

  it("rejects completing another student's attempt", async () => {
    const student = await createStudent();
    const other = await createStudent();
    const lesson = await createLesson();
    const experiment = await createExperiment({ lessonId: lesson.id });

    const attempt = await startExperimentAttempt(prisma, {
      experimentId: experiment.id,
      studentId: student.id,
    });

    await expect(
      completeExperimentAttempt(prisma, {
        attemptId: attempt.id,
        studentId: other.id,
      }),
    ).rejects.toThrow();
  });
});

describe("allRequiredExperimentsCompleted", () => {
  it("is true when the lesson has no experiments at all", async () => {
    const student = await createStudent();
    const lesson = await createLesson();

    const ready = await allRequiredExperimentsCompleted(prisma, {
      lessonId: lesson.id,
      studentId: student.id,
    });
    expect(ready).toBe(true);
  });

  it("is false while a required experiment is not yet completed, true once it is", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const experiment = await createExperiment({ lessonId: lesson.id, isRequired: true });

    expect(
      await allRequiredExperimentsCompleted(prisma, { lessonId: lesson.id, studentId: student.id }),
    ).toBe(false);

    const attempt = await startExperimentAttempt(prisma, {
      experimentId: experiment.id,
      studentId: student.id,
    });
    await completeExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id });

    expect(
      await allRequiredExperimentsCompleted(prisma, { lessonId: lesson.id, studentId: student.id }),
    ).toBe(true);
  });

  it("never blocks on an optional experiment", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    await createExperiment({ lessonId: lesson.id, isRequired: false });

    const ready = await allRequiredExperimentsCompleted(prisma, {
      lessonId: lesson.id,
      studentId: student.id,
    });
    expect(ready).toBe(true);
  });
});

describe("lesson quiz gated by required experiments", () => {
  it("blocks starting the lesson quiz until required experiments are completed", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    const experiment = await createExperiment({ lessonId: lesson.id, isRequired: true });
    const quiz = await createQuiz({ lessonId: lesson.id });

    await expect(
      startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id }),
    ).rejects.toThrow();

    const attempt = await startExperimentAttempt(prisma, {
      experimentId: experiment.id,
      studentId: student.id,
    });
    await completeExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id });

    const quizAttempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    expect(quizAttempt.id).toBeTruthy();
  });

  it("does not block a lesson quiz when the lesson has no required experiments", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    const quiz = await createQuiz({ lessonId: lesson.id });

    const quizAttempt = await startQuizAttempt(prisma, {
      quizId: quiz.id,
      studentId: student.id,
    });
    expect(quizAttempt.id).toBeTruthy();
  });
});
