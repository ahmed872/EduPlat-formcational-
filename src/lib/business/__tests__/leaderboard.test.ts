import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import {
  approveHallOfFameEntry,
  generateHallOfFameCandidates,
  getApprovedHallOfFame,
  getLeaderboard,
  getPeriodKey,
  recomputeLeaderboard,
} from "@/lib/business/leaderboard";

beforeEach(async () => {
  await resetDatabase();
});

async function createGame() {
  return prisma.game.create({
    data: { type: "MINI", name: "لعبة اختبار", config: { questions: [] } },
  });
}

async function endedSession(params: {
  gameId: string;
  studentId: string;
  score: number;
  startedAt: Date;
}) {
  return prisma.gameSession.create({
    data: {
      gameId: params.gameId,
      studentId: params.studentId,
      score: params.score,
      startedAt: params.startedAt,
      endedAt: params.startedAt,
    },
  });
}

describe("getPeriodKey", () => {
  it("formats DAILY as YYYY-MM-DD", () => {
    expect(getPeriodKey("DAILY", new Date(2026, 5, 3))).toBe("2026-06-03");
  });

  it("formats MONTHLY as YYYY-MM", () => {
    expect(getPeriodKey("MONTHLY", new Date(2026, 5, 3))).toBe("2026-06");
  });

  it("formats WEEKLY as YYYY-Www", () => {
    // 2026-06-15 is a Monday.
    expect(getPeriodKey("WEEKLY", new Date(2026, 5, 15))).toMatch(/^2026-W\d{2}$/);
  });
});

describe("recomputeLeaderboard / getLeaderboard", () => {
  it("ranks students by their best score within the current day, ignoring older sessions", async () => {
    const game = await createGame();
    const alice = await createStudent();
    const bob = await createStudent();
    const now = new Date(2026, 5, 15, 12, 0);
    const yesterday = new Date(2026, 5, 14, 12, 0);

    await endedSession({ gameId: game.id, studentId: alice.id, score: 5, startedAt: now });
    await endedSession({ gameId: game.id, studentId: alice.id, score: 9, startedAt: now });
    await endedSession({ gameId: game.id, studentId: bob.id, score: 7, startedAt: now });
    // Bob's higher score from yesterday must not count toward today's board.
    await endedSession({ gameId: game.id, studentId: bob.id, score: 100, startedAt: yesterday });

    const board = await getLeaderboard(prisma, { gameId: game.id, period: "DAILY", now });

    expect(board).toHaveLength(2);
    expect(board[0].studentId).toBe(alice.id);
    expect(board[0].score).toBe(9);
    expect(board[0].rank).toBe(1);
    expect(board[1].studentId).toBe(bob.id);
    expect(board[1].score).toBe(7);
    expect(board[1].rank).toBe(2);
  });

  it("excludes an in-progress (unended) session from ranking", async () => {
    const game = await createGame();
    const student = await createStudent();
    const now = new Date(2026, 5, 15, 12, 0);

    await prisma.gameSession.create({
      data: { gameId: game.id, studentId: student.id, startedAt: now, score: 0 },
    });

    const board = await getLeaderboard(prisma, { gameId: game.id, period: "DAILY", now });
    expect(board).toHaveLength(0);
  });

  it("replaces a stale snapshot when scores change between recomputes", async () => {
    const game = await createGame();
    const student = await createStudent();
    const now = new Date(2026, 5, 15, 12, 0);

    await endedSession({ gameId: game.id, studentId: student.id, score: 3, startedAt: now });
    await recomputeLeaderboard(prisma, { gameId: game.id, period: "DAILY", now });

    await endedSession({ gameId: game.id, studentId: student.id, score: 8, startedAt: now });
    const board = await getLeaderboard(prisma, { gameId: game.id, period: "DAILY", now });

    expect(board).toHaveLength(1);
    expect(board[0].score).toBe(8);
  });
});

describe("Hall of Fame", () => {
  it("proposes candidates from monthly totals but keeps them unapproved by default", async () => {
    const game = await createGame();
    const alice = await createStudent();
    const bob = await createStudent();
    const inMonth = new Date(2026, 5, 10);

    await endedSession({ gameId: game.id, studentId: alice.id, score: 10, startedAt: inMonth });
    await endedSession({ gameId: game.id, studentId: alice.id, score: 5, startedAt: inMonth });
    await endedSession({ gameId: game.id, studentId: bob.id, score: 8, startedAt: inMonth });

    const candidates = await generateHallOfFameCandidates(prisma, { month: "2026-06" });

    expect(candidates).toHaveLength(2);
    const alicesEntry = candidates.find((c) => c.studentId === alice.id)!;
    expect(alicesEntry.rank).toBe(1);
    expect(alicesEntry.approved).toBe(false);

    const approved = await getApprovedHallOfFame(prisma, "2026-06");
    expect(approved).toHaveLength(0);
  });

  it("shows an entry publicly only after a teacher approves it", async () => {
    const game = await createGame();
    const student = await createStudent();
    const inMonth = new Date(2026, 5, 10);
    await endedSession({ gameId: game.id, studentId: student.id, score: 20, startedAt: inMonth });

    const [candidate] = await generateHallOfFameCandidates(prisma, { month: "2026-06" });
    await approveHallOfFameEntry(prisma, { entryId: candidate.id, approvedById: "teacher-1" });

    const approved = await getApprovedHallOfFame(prisma, "2026-06");
    expect(approved).toHaveLength(1);
    expect(approved[0].studentId).toBe(student.id);
  });

  it("excludes sessions outside the requested month from the totals", async () => {
    const game = await createGame();
    const student = await createStudent();
    const outsideMonth = new Date(2026, 6, 1); // July, not June

    await endedSession({
      gameId: game.id,
      studentId: student.id,
      score: 999,
      startedAt: outsideMonth,
    });

    const candidates = await generateHallOfFameCandidates(prisma, { month: "2026-06" });
    expect(candidates).toHaveLength(0);
  });
});
