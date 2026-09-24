import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import {
  createCourse,
  createEntitlement,
  createExperiment,
  createLesson,
  createStudent,
} from "@/test/factories";
import { createQuiz } from "@/test/factories-quiz";
import {
  allRequiredExperimentsCompleted,
  getExperimentForStudent,
  getExperimentsWithStatus,
  playExperimentMove,
  startExperimentAttempt,
  submitExperimentAttempt,
} from "@/lib/business/experiment";
import { startQuizAttempt } from "@/lib/business/quiz";

beforeEach(async () => {
  await resetDatabase();
});

const SOLVED = { order: ["s1", "s2", "s3"] };

const MINI_GAME_CONFIG = {
  v: 2,
  instructions: "أجب بسرعة",
  questions: [
    { prompt: "1+1", choices: ["1", "2"], correctIndex: 1 },
    { prompt: "2+2", choices: ["4", "5"], correctIndex: 0 },
    { prompt: "3+3", choices: ["5", "6"], correctIndex: 1 },
  ],
  lives: 2,
  timeLimitSeconds: 60,
  passScore: 2,
};

/** A student who holds a live entitlement to a published lesson with one experiment. */
async function setup(options: { type?: "INTERACTIVE" | "MINI_GAME"; config?: unknown; isRequired?: boolean } = {}) {
  const student = await createStudent();
  const lesson = await createLesson();
  await createEntitlement({ studentId: student.id, lessonId: lesson.id });
  const experiment = await createExperiment({
    lessonId: lesson.id,
    type: options.type,
    config: options.config,
    isRequired: options.isRequired,
  });
  return { student, lesson, experiment };
}

async function start(experimentId: string, studentId: string) {
  return startExperimentAttempt(prisma, { experimentId, studentId });
}

describe("experiment status and completion", () => {
  it("reports an experiment as not completed before any attempt", async () => {
    const { student, lesson, experiment } = await setup();
    const statuses = await getExperimentsWithStatus(prisma, { lessonId: lesson.id, studentId: student.id });
    expect(statuses).toHaveLength(1);
    expect(statuses[0].completed).toBe(false);
    expect(statuses[0].experiment.id).toBe(experiment.id);
  });

  it("completes only after the server grades a correct submission", async () => {
    const { student, lesson, experiment } = await setup();
    const attempt = await start(experiment.id, student.id);

    const result = await submitExperimentAttempt(prisma, {
      attemptId: attempt.id,
      studentId: student.id,
      submission: SOLVED,
    });
    expect(result.passed).toBe(true);

    const statuses = await getExperimentsWithStatus(prisma, { lessonId: lesson.id, studentId: student.id });
    expect(statuses[0].completed).toBe(true);
  });

  it("reuses an in-progress attempt instead of creating a new row", async () => {
    const { student, experiment } = await setup();
    const first = await start(experiment.id, student.id);
    const second = await start(experiment.id, student.id);
    expect(second.id).toBe(first.id);
  });
});

describe("server-side validation — completion is never free", () => {
  it.each([
    ["an empty array", []],
    ["an empty object", {}],
    ["null", null],
    ["a partial order", { order: ["s1"] }],
    ["duplicated ids", { order: ["s1", "s1", "s1"] }],
    ["unknown ids", { order: ["x", "y", "z"] }],
  ])("rejects %s and leaves the attempt open", async (_label, submission) => {
    const { student, lesson, experiment } = await setup();
    const attempt = await start(experiment.id, student.id);

    await expect(
      submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id, submission }),
    ).rejects.toThrow();

    const row = await prisma.experimentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.completedAt).toBeNull();
    expect(await allRequiredExperimentsCompleted(prisma, { lessonId: lesson.id, studentId: student.id })).toBe(false);
  });

  it("records a wrong answer as a failed try without completing", async () => {
    const { student, experiment } = await setup();
    const attempt = await start(experiment.id, student.id);

    const result = await submitExperimentAttempt(prisma, {
      attemptId: attempt.id,
      studentId: student.id,
      submission: { order: ["s3", "s2", "s1"] },
    });
    expect(result.passed).toBe(false);

    const row = await prisma.experimentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.completedAt).toBeNull();
    expect(row.endedAt).toBeNull();
    expect((row.resultJson as { tries: number }).tries).toBe(1);

    // The same attempt can then be solved.
    const retry = await submitExperimentAttempt(prisma, {
      attemptId: attempt.id,
      studentId: student.id,
      submission: SOLVED,
    });
    expect(retry.passed).toBe(true);
  });

  it("refuses to submit an attempt that is already completed", async () => {
    const { student, experiment } = await setup();
    const attempt = await start(experiment.id, student.id);
    await submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id, submission: SOLVED });
    await expect(
      submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id, submission: SOLVED }),
    ).rejects.toThrow("منتهية");
  });

  it("refuses to run an experiment whose stored config is invalid", async () => {
    const { student, experiment } = await setup({ config: { v: 2, nonsense: true } });
    await expect(start(experiment.id, student.id)).rejects.toThrow("غير صالحة");
  });
});

describe("authorization on start and submit", () => {
  it("rejects submitting another student's attempt with the same error as a missing one", async () => {
    const { student, lesson, experiment } = await setup();
    const other = await createStudent();
    await createEntitlement({ studentId: other.id, lessonId: lesson.id });
    const attempt = await start(experiment.id, student.id);

    await expect(
      submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: other.id, submission: SOLVED }),
    ).rejects.toThrow("محاولة غير موجودة");
    await expect(
      submitExperimentAttempt(prisma, { attemptId: "does-not-exist", studentId: other.id, submission: SOLVED }),
    ).rejects.toThrow("محاولة غير موجودة");
  });

  it("refuses to start without an entitlement to the lesson", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const experiment = await createExperiment({ lessonId: lesson.id });
    await expect(start(experiment.id, student.id)).rejects.toThrow();
    expect(await prisma.experimentAttempt.count()).toBe(0);
  });

  it("refuses to start when the lesson is unpublished, even with an entitlement", async () => {
    const { student, lesson, experiment } = await setup();
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: "DRAFT" } });
    await expect(start(experiment.id, student.id)).rejects.toThrow();
  });

  it("refuses to start when the course is unpublished", async () => {
    const student = await createStudent();
    const course = await createCourse({ status: "DRAFT" });
    const lesson = await createLesson({ courseId: course.id });
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    const experiment = await createExperiment({ lessonId: lesson.id });
    await expect(start(experiment.id, student.id)).rejects.toThrow();
  });

  it("re-checks access on submit — unpublishing mid-attempt blocks completion", async () => {
    const { student, lesson, experiment } = await setup();
    const attempt = await start(experiment.id, student.id);
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: "DRAFT" } });
    await expect(
      submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id, submission: SOLVED }),
    ).rejects.toThrow();
    const row = await prisma.experimentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.completedAt).toBeNull();
  });

  it("re-checks access on submit — a revoked entitlement blocks completion", async () => {
    const { student, experiment } = await setup();
    const attempt = await start(experiment.id, student.id);
    await prisma.entitlement.updateMany({ where: { studentId: student.id }, data: { revokedAt: new Date() } });
    await expect(
      submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id, submission: SOLVED }),
    ).rejects.toThrow();
  });

  it("enforces the lesson prerequisite", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const first = await createLesson({ courseId: course.id });
    const second = await createLesson({ courseId: course.id, requiredPreviousLessonId: first.id });
    await createEntitlement({ studentId: student.id, lessonId: second.id });
    const experiment = await createExperiment({ lessonId: second.id });
    await expect(start(experiment.id, student.id)).rejects.toThrow();
  });

  it("lets an existing entitlement holder keep using an archived lesson", async () => {
    const { student, lesson, experiment } = await setup();
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: "ARCHIVED" } });
    const attempt = await start(experiment.id, student.id);
    const result = await submitExperimentAttempt(prisma, {
      attemptId: attempt.id,
      studentId: student.id,
      submission: SOLVED,
    });
    expect(result.passed).toBe(true);
  });
});

describe("student view never contains the answer key", () => {
  it("returns only the public projection", async () => {
    const { student, experiment } = await setup({ type: "MINI_GAME", config: MINI_GAME_CONFIG });
    const view = await getExperimentForStudent(prisma, { experimentId: experiment.id, studentId: student.id });
    expect(JSON.stringify(view)).not.toContain("correctIndex");
    expect(view.publicExperiment.kind).toBe("MINI_GAME");
  });

  it("refuses the view without access", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const experiment = await createExperiment({ lessonId: lesson.id });
    await expect(
      getExperimentForStudent(prisma, { experimentId: experiment.id, studentId: student.id }),
    ).rejects.toThrow();
  });
});

describe("mini game — server-side moves", () => {
  async function game() {
    const ctx = await setup({ type: "MINI_GAME", config: MINI_GAME_CONFIG });
    const attempt = await start(ctx.experiment.id, ctx.student.id);
    const play = (move: unknown, now?: Date) =>
      playExperimentMove(prisma, { attemptId: attempt.id, studentId: ctx.student.id, move, now });
    return { ...ctx, attempt, play };
  }

  it("wins after enough correct answers and completes the attempt", async () => {
    const { attempt, play } = await game();
    expect((await play({ questionIndex: 0, choiceIndex: 1 })).correct).toBe(true);
    const second = await play({ questionIndex: 1, choiceIndex: 0 });
    expect(second.correct).toBe(true);
    expect(second.finished).toBeNull();
    const last = await play({ questionIndex: 2, choiceIndex: 0 });
    expect(last.finished?.passed).toBe(true);
    const row = await prisma.experimentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.completedAt).not.toBeNull();
  });

  it("never returns the correct choice", async () => {
    const { play } = await game();
    const result = await play({ questionIndex: 0, choiceIndex: 0 });
    expect(result.correct).toBe(false);
    expect(JSON.stringify(result)).not.toContain("correctIndex");
  });

  it("losing all lives ends the round as a failure", async () => {
    const { attempt, play } = await game();
    await play({ questionIndex: 0, choiceIndex: 0 });
    const end = await play({ questionIndex: 1, choiceIndex: 1 });
    expect(end.finished?.passed).toBe(false);
    const row = await prisma.experimentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.completedAt).toBeNull();
    expect(row.endedAt).not.toBeNull();
    await expect(play({ questionIndex: 2, choiceIndex: 1 })).rejects.toThrow();
  });

  it("rejects out-of-order and repeated answers", async () => {
    const { play } = await game();
    await expect(play({ questionIndex: 1, choiceIndex: 0 })).rejects.toThrow();
    await play({ questionIndex: 0, choiceIndex: 1 });
    await expect(play({ questionIndex: 0, choiceIndex: 1 })).rejects.toThrow();
  });

  it("rejects malformed moves and out-of-range choices", async () => {
    const { play } = await game();
    await expect(play([])).rejects.toThrow();
    await expect(play({})).rejects.toThrow();
    await expect(play({ questionIndex: 0, choiceIndex: 9 })).rejects.toThrow();
  });

  it("ignores answers sent after the server-side time limit", async () => {
    const { attempt, play } = await game();
    const late = new Date(attempt.startedAt.getTime() + (60 + 11) * 1000);
    const result = await play({ questionIndex: 0, choiceIndex: 1 }, late);
    expect(result.finished?.passed).toBe(false);
    expect(result.state.timedOut).toBe(true);
    expect(result.state.correct).toBe(0);
  });

  it("refuses an early timeout move", async () => {
    const { play } = await game();
    await expect(play({ timeout: true })).rejects.toThrow("لم ينتهِ الوقت");
  });

  it("does not allow submitSubmission to finish a game in one shot", async () => {
    const { attempt, student } = await game();
    await expect(
      submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id, submission: {} }),
    ).rejects.toThrow();
  });

  it("rejects another student's move", async () => {
    const { attempt, lesson } = await game();
    const other = await createStudent();
    await createEntitlement({ studentId: other.id, lessonId: lesson.id });
    await expect(
      playExperimentMove(prisma, { attemptId: attempt.id, studentId: other.id, move: { questionIndex: 0, choiceIndex: 1 } }),
    ).rejects.toThrow("محاولة غير موجودة");
  });

  it("applies only one of two concurrent moves built on the same state", async () => {
    const { attempt, student } = await game();
    // A client that read the attempt before the other move landed.
    const stale = prisma.$extends({
      query: {
        experimentAttempt: {
          async findUnique({ args, query }) {
            const row = await query(args);
            return row ? { ...row, resultJson: { state: { answers: [], correct: 0, streak: 0, bestStreak: 0, livesLeft: 2, done: false } } } : row;
          },
        },
      },
    }) as unknown as typeof prisma;

    await playExperimentMove(prisma, { attemptId: attempt.id, studentId: student.id, move: { questionIndex: 0, choiceIndex: 1 } });
    await expect(
      playExperimentMove(stale, { attemptId: attempt.id, studentId: student.id, move: { questionIndex: 0, choiceIndex: 0 } }),
    ).rejects.toThrow("حركة أخرى");
    const row = await prisma.experimentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect((row.resultJson as { state: { answers: number[] } }).state.answers).toEqual([1]);
  });
});

describe("allRequiredExperimentsCompleted", () => {
  it("is true when the lesson has no experiments at all", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    expect(await allRequiredExperimentsCompleted(prisma, { lessonId: lesson.id, studentId: student.id })).toBe(true);
  });

  it("is false while a required experiment is not yet completed, true once it is", async () => {
    const { student, lesson, experiment } = await setup({ isRequired: true });
    expect(await allRequiredExperimentsCompleted(prisma, { lessonId: lesson.id, studentId: student.id })).toBe(false);
    const attempt = await start(experiment.id, student.id);
    await submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id, submission: SOLVED });
    expect(await allRequiredExperimentsCompleted(prisma, { lessonId: lesson.id, studentId: student.id })).toBe(true);
  });

  it("never blocks on an optional experiment", async () => {
    const { student, lesson } = await setup({ isRequired: false });
    expect(await allRequiredExperimentsCompleted(prisma, { lessonId: lesson.id, studentId: student.id })).toBe(true);
  });
});

describe("lesson quiz gated by required experiments", () => {
  it("blocks starting the lesson quiz until required experiments are completed", async () => {
    const { student, lesson, experiment } = await setup({ isRequired: true });
    const quiz = await createQuiz({ lessonId: lesson.id });

    await expect(startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id })).rejects.toThrow();

    // A failed try does not unlock the quiz.
    const attempt = await start(experiment.id, student.id);
    await submitExperimentAttempt(prisma, {
      attemptId: attempt.id,
      studentId: student.id,
      submission: { order: ["s2", "s1", "s3"] },
    });
    await expect(startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id })).rejects.toThrow();

    await submitExperimentAttempt(prisma, { attemptId: attempt.id, studentId: student.id, submission: SOLVED });
    const quizAttempt = await startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id });
    expect(quizAttempt.id).toBeTruthy();
  });

  it("does not block a lesson quiz when the lesson has no required experiments", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    const quiz = await createQuiz({ lessonId: lesson.id });
    const quizAttempt = await startQuizAttempt(prisma, { quizId: quiz.id, studentId: student.id });
    expect(quizAttempt.id).toBeTruthy();
  });
});
