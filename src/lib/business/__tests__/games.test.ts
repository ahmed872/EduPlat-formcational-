import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import { canPlayGame, startGameSession, submitGameScore } from "@/lib/business/games";

beforeEach(async () => {
  await resetDatabase();
});

async function createMiniGame(
  overrides: { active?: boolean; questions?: unknown[] } = {},
) {
  return prisma.game.create({
    data: {
      type: "MINI",
      name: "لعبة سريعة",
      active: overrides.active ?? true,
      config: { questions: overrides.questions ?? [] } as never,
    },
  });
}

async function createDailyGame(overrides: { dailyOpenTime?: string | null } = {}) {
  return prisma.game.create({
    data: {
      type: "DAILY_MAIN",
      name: "التحدي اليومي",
      dailyOpenTime: overrides.dailyOpenTime ?? "08:00",
      config: { questions: [] },
    },
  });
}

describe("canPlayGame", () => {
  it("blocks an inactive game regardless of type", async () => {
    const student = await createStudent();
    const game = await createMiniGame({ active: false });

    const decision = await canPlayGame(prisma, { gameId: game.id, studentId: student.id });
    expect(decision).toEqual({ allowed: false, reason: "NOT_ACTIVE" });
  });

  it("allows a MINI game to be played repeatedly the same day", async () => {
    const student = await createStudent();
    const game = await createMiniGame();

    await startGameSession(prisma, { gameId: game.id, studentId: student.id });
    const decision = await canPlayGame(prisma, { gameId: game.id, studentId: student.id });
    expect(decision).toEqual({ allowed: true });
  });

  it("blocks a DAILY_MAIN game before its daily open time", async () => {
    const student = await createStudent();
    const game = await createDailyGame({ dailyOpenTime: "20:00" });
    const now = new Date(2026, 5, 15, 9, 0); // 09:00, before 20:00

    const decision = await canPlayGame(prisma, { gameId: game.id, studentId: student.id, now });
    expect(decision).toEqual({ allowed: false, reason: "NOT_OPEN_YET" });
  });

  it("allows a DAILY_MAIN game once its open time has passed today", async () => {
    const student = await createStudent();
    const game = await createDailyGame({ dailyOpenTime: "08:00" });
    const now = new Date(2026, 5, 15, 9, 0);

    const decision = await canPlayGame(prisma, { gameId: game.id, studentId: student.id, now });
    expect(decision).toEqual({ allowed: true });
  });

  it("blocks a second DAILY_MAIN play on the same day", async () => {
    const student = await createStudent();
    const game = await createDailyGame({ dailyOpenTime: "08:00" });
    const now = new Date(2026, 5, 15, 9, 0);

    await startGameSession(prisma, { gameId: game.id, studentId: student.id, now });
    const decision = await canPlayGame(prisma, { gameId: game.id, studentId: student.id, now });
    expect(decision).toEqual({ allowed: false, reason: "ALREADY_PLAYED_TODAY" });
  });

  it("allows a DAILY_MAIN play the next day after yesterday's session", async () => {
    const student = await createStudent();
    const game = await createDailyGame({ dailyOpenTime: "08:00" });
    const yesterday = new Date(2026, 5, 15, 9, 0);
    const today = new Date(2026, 5, 16, 9, 0);

    await startGameSession(prisma, { gameId: game.id, studentId: student.id, now: yesterday });
    const decision = await canPlayGame(prisma, {
      gameId: game.id,
      studentId: student.id,
      now: today,
    });
    expect(decision).toEqual({ allowed: true });
  });
});

describe("startGameSession", () => {
  it("throws when the game cannot currently be played", async () => {
    const student = await createStudent();
    const game = await createMiniGame({ active: false });

    await expect(
      startGameSession(prisma, { gameId: game.id, studentId: student.id }),
    ).rejects.toThrow(/NOT_ACTIVE/);
  });
});

describe("submitGameScore", () => {
  const questions = [
    { prompt: "1+1?", choices: ["1", "2", "3"], correctIndex: 1 },
    { prompt: "2+2?", choices: ["3", "4", "5"], correctIndex: 1 },
    { prompt: "3+3?", choices: ["5", "6", "7"], correctIndex: 1 },
  ];

  it("recomputes the score from the student's answers against the real answer key, and credits it to points", async () => {
    const student = await createStudent();
    const game = await createMiniGame({ questions });
    const session = await startGameSession(prisma, { gameId: game.id, studentId: student.id });

    // 2 correct (index 0 and 1), 1 wrong (index 2) — score must be 2, not
    // whatever a caller might otherwise expect to freely dictate.
    const updated = await submitGameScore(prisma, {
      sessionId: session.id,
      studentId: student.id,
      answers: [1, 1, 0],
    });

    expect(updated.score).toBe(2);
    expect(updated.endedAt).not.toBeNull();

    const refreshedStudent = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: student.id },
    });
    expect(refreshedStudent.points).toBe(2);
  });

  it("never trusts a client-supplied score — an arbitrarily large/forged answers array cannot exceed the real question count", async () => {
    // Regression test for a real bug: the score used to be taken directly
    // from the client with no validation, letting a single forged request
    // credit unbounded points that fed leaderboards/achievements. Even a
    // maximally "generous" (all-correct) answers array can never award more
    // points than there are real questions in the game.
    const student = await createStudent();
    const game = await createMiniGame({ questions });
    const session = await startGameSession(prisma, { gameId: game.id, studentId: student.id });

    const updated = await submitGameScore(prisma, {
      sessionId: session.id,
      studentId: student.id,
      // Ridiculous oversized/forged answers array — extra entries beyond
      // the real question count must be ignored, and correct guesses for
      // indices that don't exist can't manufacture extra points.
      answers: [1, 1, 1, 999, 999, 999, 999, 999, 999, 999],
    });

    expect(updated.score).toBe(3); // all 3 real questions answered correctly, nothing more
  });

  it("rejects submitting a score for another student's session", async () => {
    const student = await createStudent();
    const otherStudent = await createStudent();
    const game = await createMiniGame({ questions });
    const session = await startGameSession(prisma, { gameId: game.id, studentId: student.id });

    await expect(
      submitGameScore(prisma, {
        sessionId: session.id,
        studentId: otherStudent.id,
        answers: [1, 1, 1],
      }),
    ).rejects.toThrow(/لا يمكنك/);
  });

  it("rejects submitting a score twice for the same session", async () => {
    const student = await createStudent();
    const game = await createMiniGame({ questions });
    const session = await startGameSession(prisma, { gameId: game.id, studentId: student.id });

    await submitGameScore(prisma, { sessionId: session.id, studentId: student.id, answers: [1] });
    await expect(
      submitGameScore(prisma, {
        sessionId: session.id,
        studentId: student.id,
        answers: [1, 1, 1],
      }),
    ).rejects.toThrow(/بالفعل/);
  });
});
