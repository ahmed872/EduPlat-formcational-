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

/**
 * Which fixed-length "availability window" `date` falls into, for a given
 * window size — e.g. with the default 60-minute window this is exactly the
 * UTC clock hour (epoch 0 is itself an hour boundary, so the floor division
 * lines up with wall-clock hours). Used to give MINI games a real,
 * DB-enforced "once per hour" gate via GameSession.cooldownBucket, the same
 * structural pattern DAILY_MAIN's playDate already uses for "once per day".
 */
function cooldownBucketFor(date: Date, cooldownMinutes: number): number {
  return Math.floor(date.getTime() / (cooldownMinutes * 60_000));
}

export type PlayDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "NOT_ACTIVE" | "NOT_OPEN_YET" | "ALREADY_PLAYED_TODAY" | "COOLDOWN_ACTIVE";
    };

/**
 * MINI games are replayable, but only once per `miniCooldownMinutes`
 * window (default 60 — "hourly"). DAILY_MAIN games open at a fixed
 * time-of-day and allow exactly one session per calendar day — matching
 * the "daily challenge" concept the schema's dailyOpenTime field implies.
 * Both checks here are fast, friendly pre-checks for the UI; the actual
 * enforcement that survives a race is the real DB unique constraint
 * startGameSession relies on below.
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
    const currentBucket = cooldownBucketFor(now, game.miniCooldownMinutes);
    const playedThisWindow = await prisma.gameSession.findFirst({
      where: { gameId: params.gameId, studentId: params.studentId, cooldownBucket: currentBucket },
    });
    if (playedThisWindow) {
      return { allowed: false, reason: "COOLDOWN_ACTIVE" };
    }
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
  // DAILY_MAIN sessions get a real playDate, and MINI sessions get a real
  // cooldownBucket — each backed by its own DB-level @@unique constraint.
  // The canPlayGame() check above is a fast, friendly rejection, but it is
  // a plain read that two concurrent requests could both pass (classic
  // TOCTOU). The unique constraints are what actually prevent two sessions
  // for the same student+game+window from ever both being created, even
  // under a genuine race (two tabs/devices tapping "play" at once) — not a
  // client-side timer or cooldown, which proves nothing about what the
  // server will actually accept.
  const playDate = game.type === "DAILY_MAIN" ? startOfDay(now) : null;
  const cooldownBucket =
    game.type === "MINI" ? cooldownBucketFor(now, game.miniCooldownMinutes) : null;

  try {
    return await prisma.gameSession.create({
      data: {
        gameId: params.gameId,
        studentId: params.studentId,
        startedAt: now,
        playDate,
        cooldownBucket,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(
        `Cannot start game: ${game.type === "MINI" ? "COOLDOWN_ACTIVE" : "ALREADY_PLAYED_TODAY"}`,
      );
    }
    throw error;
  }
}

/** Small network/latency buffer on top of the game's own durationMinutes —
 * same idea, and same size, as quiz.ts's SUBMIT_GRACE_SECONDS. */
const GAME_SUBMIT_GRACE_SECONDS = 20;

function gameDeadlineMs(session: { startedAt: Date }, game: { durationMinutes: number }): number {
  return session.startedAt.getTime() + game.durationMinutes * 60_000 + GAME_SUBMIT_GRACE_SECONDS * 1000;
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
 *
 * The game's own durationMinutes (~5 for MINI, ~10 for DAILY_MAIN, both
 * teacher-configurable) is also enforced here, server-side, against
 * session.startedAt — the countdown shown in the player UI is a client-side
 * convenience only and proves nothing about what the server will accept; a
 * request submitted after the real deadline earns zero points regardless of
 * how many answers were correct, so simply holding a session open past its
 * time limit (to look up answers, ask someone else, etc.) never helps.
 */
export async function submitGameScore(
  prisma: PrismaClient,
  params: { sessionId: string; studentId: string; answers: number[]; now?: Date },
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

  const now = params.now ?? new Date();
  const expired = now.getTime() > gameDeadlineMs(session, session.game);
  if (expired) {
    await prisma.gameSession.update({
      where: { id: params.sessionId },
      data: { endedAt: now, score: 0 },
    });
    throw new Error("انتهت مهلة اللعبة، لم يتم اعتماد أي نقاط");
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
      data: { endedAt: now, score },
    }),
    prisma.studentProfile.update({
      where: { id: params.studentId },
      data: { points: { increment: score } },
    }),
  ]);

  await evaluateAchievementsForStudent(prisma, params.studentId);

  return updated;
}
