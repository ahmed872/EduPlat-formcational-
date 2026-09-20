import type { PrismaClient } from "@prisma/client";
import { evaluateAchievementsForStudent } from "@/lib/business/achievements";
import { isUniqueConstraintError } from "@/lib/prisma-errors";

export type GameQuestion = {
  prompt: string;
  choices: string[];
  correctIndex: number;
};

/** The client-safe projection of a question — never includes correctIndex. */
export type PublicGameQuestion = Pick<GameQuestion, "prompt" | "choices">;

export function toPublicGameQuestions(questions: GameQuestion[]): PublicGameQuestion[] {
  return questions.map(({ prompt, choices }) => ({ prompt, choices }));
}

function parseDailyOpenTime(dailyOpenTime: string) {
  const [hours, minutes] = dailyOpenTime.split(":").map(Number);
  return { hours, minutes };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export type PlayDecision =
  | { allowed: true }
  | { allowed: false; reason: "NOT_ACTIVE" | "NOT_OPEN_YET" | "ALREADY_PLAYED_TODAY" };

/**
 * MINI games are always replayable. DAILY_MAIN games open at a fixed
 * time-of-day and allow exactly one session per calendar day — matching
 * the "daily challenge" concept the schema's dailyOpenTime field implies.
 */
export async function canPlayGame(
  prisma: PrismaClient,
  params: { gameId: string; studentId: string; now?: Date },
): Promise<PlayDecision> {
  const now = params.now ?? new Date();
  const game = await prisma.game.findUniqueOrThrow({ where: { id: params.gameId } });

  if (!game.active) {
    return { allowed: false, reason: "NOT_ACTIVE" };
  }

  if (game.type === "MINI") {
    return { allowed: true };
  }

  // DAILY_MAIN
  if (game.dailyOpenTime) {
    const { hours, minutes } = parseDailyOpenTime(game.dailyOpenTime);
    const opensAt = new Date(now);
    opensAt.setHours(hours, minutes, 0, 0);
    if (now < opensAt) {
      return { allowed: false, reason: "NOT_OPEN_YET" };
    }
  }

  const todayStart = startOfDay(now);
  const playedToday = await prisma.gameSession.findFirst({
    where: {
      gameId: params.gameId,
      studentId: params.studentId,
      startedAt: { gte: todayStart },
    },
  });
  if (playedToday) {
    return { allowed: false, reason: "ALREADY_PLAYED_TODAY" };
  }

  return { allowed: true };
}

export async function startGameSession(
  prisma: PrismaClient,
  params: { gameId: string; studentId: string; now?: Date },
) {
  const decision = await canPlayGame(prisma, params);
  if (!decision.allowed) {
    throw new Error(`Cannot start game: ${decision.reason}`);
  }

  const now = params.now ?? new Date();
  const game = await prisma.game.findUniqueOrThrow({ where: { id: params.gameId } });
  // DAILY_MAIN sessions get a real playDate, backed by a DB-level
  // @@unique([gameId, studentId, playDate]) constraint — the earlier
  // canPlayGame() check above is a fast, friendly rejection, but it is a
  // plain read that two concurrent requests could both pass (classic
  // TOCTOU). The unique constraint is what actually prevents two sessions
  // for the same student+game+day from ever both being created, even
  // under a genuine race (two tabs/devices tapping "play" at once).
  const playDate = game.type === "DAILY_MAIN" ? startOfDay(now) : null;

  try {
    return await prisma.gameSession.create({
      data: {
        gameId: params.gameId,
        studentId: params.studentId,
        startedAt: now,
        playDate,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("Cannot start game: ALREADY_PLAYED_TODAY");
    }
    throw error;
  }
}

/**
 * Ends a session and credits points to the student's cumulative total — the
 * one place StudentProfile.points is ever written, since nothing consumed it
 * before this phase.
 *
 * The score is NEVER taken from the client: it is recomputed here from the
 * student's submitted choice indices against the game's own answer key
 * (Game.config.questions[i].correctIndex, which is never sent to the
 * browser in the first place — see toPublicGameQuestions). A client-supplied
 * numeric score would otherwise be trusted as-is and credited directly,
 * letting a single forged request award unbounded points that feed
 * leaderboards, Hall-of-Fame candidacy, and points-based achievements.
 */
export async function submitGameScore(
  prisma: PrismaClient,
  params: { sessionId: string; studentId: string; answers: number[] },
) {
  const session = await prisma.gameSession.findUniqueOrThrow({
    where: { id: params.sessionId },
    include: { game: true },
  });
  if (session.studentId !== params.studentId) {
    throw new Error("لا يمكنك إنهاء جلسة لعب طالب آخر");
  }
  if (session.endedAt) {
    throw new Error("تم إنهاء هذه الجلسة بالفعل");
  }

  const config = (session.game.config ?? { questions: [] }) as { questions: GameQuestion[] };
  const questions = config.questions ?? [];
  const score = questions.reduce(
    (count, question, index) => (params.answers[index] === question.correctIndex ? count + 1 : count),
    0,
  );

  const [updated] = await prisma.$transaction([
    prisma.gameSession.update({
      where: { id: params.sessionId },
      data: { endedAt: new Date(), score },
    }),
    prisma.studentProfile.update({
      where: { id: params.studentId },
      data: { points: { increment: score } },
    }),
  ]);

  await evaluateAchievementsForStudent(prisma, params.studentId);

  return updated;
}
