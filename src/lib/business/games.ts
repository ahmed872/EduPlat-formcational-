import type { PrismaClient } from "@prisma/client";
import { evaluateAchievementsForStudent } from "@/lib/business/achievements";

export type GameQuestion = {
  prompt: string;
  choices: string[];
  correctIndex: number;
};

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

  return prisma.gameSession.create({
    data: {
      gameId: params.gameId,
      studentId: params.studentId,
      startedAt: params.now ?? new Date(),
    },
  });
}

/**
 * Ends a session with its final score and credits the same amount to the
 * student's cumulative points — the one place StudentProfile.points is
 * ever written, since nothing consumed it before this phase.
 */
export async function submitGameScore(
  prisma: PrismaClient,
  params: { sessionId: string; studentId: string; score: number },
) {
  const session = await prisma.gameSession.findUniqueOrThrow({
    where: { id: params.sessionId },
  });
  if (session.studentId !== params.studentId) {
    throw new Error("لا يمكنك إنهاء جلسة لعب طالب آخر");
  }
  if (session.endedAt) {
    throw new Error("تم إنهاء هذه الجلسة بالفعل");
  }

  const [updated] = await prisma.$transaction([
    prisma.gameSession.update({
      where: { id: params.sessionId },
      data: { endedAt: new Date(), score: params.score },
    }),
    prisma.studentProfile.update({
      where: { id: params.studentId },
      data: { points: { increment: params.score } },
    }),
  ]);

  await evaluateAchievementsForStudent(prisma, params.studentId);

  return updated;
}
