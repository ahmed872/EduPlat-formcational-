import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import { canPlayGame, startGameSession, submitGameScore } from "@/lib/business/games";

beforeEach(async () => {
  await resetDatabase();
});

async function createMiniGame(
  overrides: {
    active?: boolean;
    questions?: unknown[];
    durationMinutes?: number;
    miniCooldownMinutes?: number;
  } = {},
) {
  return prisma.game.create({
    data: {
      type: "MINI",
      name: "لعبة سريعة",
      active: overrides.active ?? true,
      durationMinutes: overrides.durationMinutes ?? 5,
      miniCooldownMinutes: overrides.miniCooldownMinutes ?? 60,
      config: { questions: overrides.questions ?? [] } as never,
    },
  });
}

async function createDailyGame(
  overrides: { dailyOpenTime?: string | null; durationMinutes?: number; questions?: unknown[] } = {},
) {
  return prisma.game.create({
    data: {
      type: "DAILY_MAIN",
      name: "التحدي اليومي",
      dailyOpenTime: overrides.dailyOpenTime ?? "08:00",
      durationMinutes: overrides.durationMinutes ?? 10,
      config: { questions: overrides.questions ?? [] } as never,
    },
  });
}

// Fixed UTC instants so the 60-minute MINI window (which is exactly the UTC
// clock hour — see cooldownBucketFor) is deterministic regardless of the
// machine's local timezone.
const at = (hour: number, minute: number) => new Date(Date.UTC(2026, 5, 15, hour, minute));

describe("canPlayGame", () => {
  it("blocks an inactive game regardless of type", async () => {
    const student = await createStudent();
    const game = await createMiniGame({ active: false });

    const decision = await canPlayGame(prisma, { gameId: game.id, studentId: student.id });
    expect(decision).toEqual({ allowed: false, reason: "NOT_ACTIVE" });
  });

  // Final audit gap #5: MINI used to be replayable with no limit at all —
  // the only MINI/DAILY_MAIN difference was DAILY_MAIN's once-per-day gate.
  // MINI is now "once per hour" (configurable), enforced server-side.
  it("blocks a second MINI play inside the same hourly window", async () => {
    const student = await createStudent();
    const game = await createMiniGame();

    await startGameSession(prisma, { gameId: game.id, studentId: student.id, now: at(9, 10) });
    const decision = await canPlayGame(prisma, {
      gameId: game.id,
      studentId: student.id,
      now: at(9, 50),
    });
    expect(decision).toEqual({ allowed: false, reason: "COOLDOWN_ACTIVE" });
    await expect(
      startGameSession(prisma, { gameId: game.id, studentId: student.id, now: at(9, 50) }),
    ).rejects.toThrow(/COOLDOWN_ACTIVE/);
  });

  it("allows a MINI game again once the next hourly window opens, still the same day", async () => {
    const student = await createStudent();
    const game = await createMiniGame();

    await startGameSession(prisma, { gameId: game.id, studentId: student.id, now: at(9, 10) });
    const decision = await canPlayGame(prisma, {
      gameId: game.id,
      studentId: student.id,
      now: at(10, 5),
    });
    expect(decision).toEqual({ allowed: true });
    await expect(
      startGameSession(prisma, { gameId: game.id, studentId: student.id, now: at(10, 5) }),
    ).resolves.toBeTruthy();
  });

  it("respects a teacher-configured MINI cooldown window other than 60 minutes", async () => {
    const student = await createStudent();
    const game = await createMiniGame({ miniCooldownMinutes: 15 });

    await startGameSession(prisma, { gameId: game.id, studentId: student.id, now: at(9, 1) });
    expect(
      await canPlayGame(prisma, { gameId: game.id, studentId: student.id, now: at(9, 14) }),
    ).toEqual({ allowed: false, reason: "COOLDOWN_ACTIVE" });
    expect(
      await canPlayGame(prisma, { gameId: game.id, studentId: student.id, now: at(9, 16) }),
    ).toEqual({ allowed: true });
  });

  it("MINI cooldown is per student — one student's play never blocks another's", async () => {
    const student = await createStudent();
    const otherStudent = await createStudent();
    const game = await createMiniGame();

    await startGameSession(prisma, { gameId: game.id, studentId: student.id, now: at(9, 10) });
    expect(
      await canPlayGame(prisma, { gameId: game.id, studentId: otherStudent.id, now: at(9, 20) }),
    ).toEqual({ allowed: true });
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

  it("MINI cooldown holds even when the pre-check read is stale (the race, reproduced deterministically) — enforced by the DB constraint", async () => {
    const student = await createStudent();
    const game = await createMiniGame();
    // What the losing request of a real race sees: its "played this window?"
    // read ran before the winner's insert committed.
    const staleReadClient = prisma.$extends({
      query: { gameSession: { findFirst: async () => null } },
    }) as unknown as PrismaClient;

    await startGameSession(prisma, { gameId: game.id, studentId: student.id, now: at(9, 30) });
    await expect(
      startGameSession(staleReadClient, { gameId: game.id, studentId: student.id, now: at(9, 45) }),
    ).rejects.toThrow(/COOLDOWN_ACTIVE/);
    expect(await prisma.gameSession.count({ where: { gameId: game.id } })).toBe(1);
  });

  it("lets only one of several concurrent MINI starts in the same window succeed", async () => {
    const student = await createStudent();
    const game = await createMiniGame();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        startGameSession(prisma, { gameId: game.id, studentId: student.id, now: at(9, 30) }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason.message).toMatch(/COOLDOWN_ACTIVE/);
    }
    expect(await prisma.gameSession.count({ where: { gameId: game.id } })).toBe(1);
  });
});

describe("server-side duration enforcement (final audit gap #5)", () => {
  const questions = [
    { prompt: "1+1?", choices: ["1", "2", "3"], correctIndex: 1 },
    { prompt: "2+2?", choices: ["3", "4", "5"], correctIndex: 1 },
  ];

  it("credits a MINI score submitted within its ~5-minute limit", async () => {
    const student = await createStudent();
    const game = await createMiniGame({ questions, durationMinutes: 5 });
    const session = await startGameSession(prisma, {
      gameId: game.id,
      studentId: student.id,
      now: at(9, 0),
    });

    const updated = await submitGameScore(prisma, {
      sessionId: session.id,
      studentId: student.id,
      answers: [1, 1],
      now: new Date(at(9, 4).getTime() + 50_000),
    });
    expect(updated.score).toBe(2);
  });

  it("rejects a MINI submission after its ~5-minute limit with zero points, even with every answer correct", async () => {
    const student = await createStudent();
    const game = await createMiniGame({ questions, durationMinutes: 5 });
    const session = await startGameSession(prisma, {
      gameId: game.id,
      studentId: student.id,
      now: at(9, 0),
    });

    // Held open well past 5 minutes (+20s grace) — e.g. a forged direct
    // server-action call that ignores the client-side countdown entirely.
    await expect(
      submitGameScore(prisma, {
        sessionId: session.id,
        studentId: student.id,
        answers: [1, 1],
        now: at(9, 30),
      }),
    ).rejects.toThrow(/انتهت مهلة/);

    const stored = await prisma.gameSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.score).toBe(0);
    expect(stored.endedAt).not.toBeNull();
    const refreshed = await prisma.studentProfile.findUniqueOrThrow({ where: { id: student.id } });
    expect(refreshed.points).toBe(0);

    // And the expired session can't then be re-submitted for credit.
    await expect(
      submitGameScore(prisma, {
        sessionId: session.id,
        studentId: student.id,
        answers: [1, 1],
        now: at(9, 1),
      }),
    ).rejects.toThrow(/بالفعل/);
  });

  it("gives DAILY_MAIN its own longer ~10-minute limit — 8 minutes is fine, 11 is not", async () => {
    const student = await createStudent();
    const otherStudent = await createStudent();
    const game = await createDailyGame({ questions, durationMinutes: 10 });

    const onTime = await startGameSession(prisma, {
      gameId: game.id,
      studentId: student.id,
      now: new Date(2026, 5, 15, 9, 0),
    });
    const ok = await submitGameScore(prisma, {
      sessionId: onTime.id,
      studentId: student.id,
      answers: [1, 1],
      now: new Date(2026, 5, 15, 9, 8),
    });
    expect(ok.score).toBe(2);

    const late = await startGameSession(prisma, {
      gameId: game.id,
      studentId: otherStudent.id,
      now: new Date(2026, 5, 15, 9, 0),
    });
    await expect(
      submitGameScore(prisma, {
        sessionId: late.id,
        studentId: otherStudent.id,
        answers: [1, 1],
        now: new Date(2026, 5, 15, 9, 11),
      }),
    ).rejects.toThrow(/انتهت مهلة/);
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
