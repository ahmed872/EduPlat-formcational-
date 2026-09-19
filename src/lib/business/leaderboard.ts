import type { LeaderboardPeriod, PrismaClient } from "@prisma/client";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** ISO week number (1-53), matching the "YYYY-Www" convention. */
function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function getPeriodKey(period: LeaderboardPeriod, date: Date): string {
  if (period === "DAILY") {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  if (period === "MONTHLY") {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }
  if (period === "WEEKLY") {
    const { year, week } = isoWeek(date);
    return `${year}-W${pad(week)}`;
  }
  throw new Error("CUSTOM period requires an explicit periodKey, not a date");
}

function periodRange(period: LeaderboardPeriod, date: Date): { start: Date; end: Date } {
  if (period === "DAILY") {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start, end };
  }
  if (period === "MONTHLY") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    end.setMilliseconds(-1);
    return { start, end };
  }
  // WEEKLY: Monday-start week containing `date`.
  const day = date.getDay() || 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (day - 1));
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/**
 * Recomputes a game's leaderboard for the period containing `now`, from
 * real GameSession rows (each student's best score in that window), and
 * replaces the cached snapshot. Called opportunistically whenever a
 * leaderboard is viewed — no scheduler is available in this environment
 * (same note as syncExpiredSubscriptions()).
 */
export async function recomputeLeaderboard(
  prisma: PrismaClient,
  params: { gameId: string; period: LeaderboardPeriod; now?: Date },
) {
  const now = params.now ?? new Date();
  const periodKey = getPeriodKey(params.period, now);
  const { start, end } = periodRange(params.period, now);

  const sessions = await prisma.gameSession.findMany({
    where: {
      gameId: params.gameId,
      endedAt: { not: null },
      startedAt: { gte: start, lte: end },
    },
  });

  const bestByStudent = new Map<string, number>();
  for (const s of sessions) {
    const current = bestByStudent.get(s.studentId) ?? -Infinity;
    if (s.score > current) bestByStudent.set(s.studentId, s.score);
  }

  const ranked = Array.from(bestByStudent.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([studentId, score], i) => ({ studentId, score, rank: i + 1 }));

  await prisma.$transaction([
    prisma.leaderboardSnapshot.deleteMany({
      where: { gameId: params.gameId, period: params.period, periodKey },
    }),
    ...ranked.map((entry) =>
      prisma.leaderboardSnapshot.create({
        data: {
          gameId: params.gameId,
          period: params.period,
          periodKey,
          studentId: entry.studentId,
          rank: entry.rank,
          score: entry.score,
        },
      }),
    ),
  ]);

  return periodKey;
}

export async function getLeaderboard(
  prisma: PrismaClient,
  params: { gameId: string; period: LeaderboardPeriod; now?: Date; limit?: number },
) {
  const periodKey = await recomputeLeaderboard(prisma, params);

  return prisma.leaderboardSnapshot.findMany({
    where: { gameId: params.gameId, period: params.period, periodKey },
    include: { student: { include: { user: true } } },
    orderBy: { rank: "asc" },
    take: params.limit ?? 20,
  });
}

/**
 * Candidates are proposed from real GameSession scores summed over the
 * month, but never shown publicly until a teacher approves them — nothing
 * here grants public recognition on its own.
 */
export async function generateHallOfFameCandidates(
  prisma: PrismaClient,
  params: { month: string; topN?: number },
) {
  const [year, month] = params.month.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  end.setMilliseconds(-1);

  const sessions = await prisma.gameSession.findMany({
    where: { endedAt: { not: null }, startedAt: { gte: start, lte: end } },
  });

  const totalByStudent = new Map<string, number>();
  for (const s of sessions) {
    totalByStudent.set(s.studentId, (totalByStudent.get(s.studentId) ?? 0) + s.score);
  }

  const ranked = Array.from(totalByStudent.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, params.topN ?? 10)
    .map(([studentId, score], i) => ({ studentId, score, rank: i + 1 }));

  const created = [];
  for (const entry of ranked) {
    const row = await prisma.hallOfFameEntry.upsert({
      where: { month_studentId: { month: params.month, studentId: entry.studentId } },
      create: { month: params.month, studentId: entry.studentId, rank: entry.rank },
      update: { rank: entry.rank },
    });
    created.push(row);
  }
  return created;
}

export async function approveHallOfFameEntry(
  prisma: PrismaClient,
  params: { entryId: string; approvedById: string },
) {
  return prisma.hallOfFameEntry.update({
    where: { id: params.entryId },
    data: { approved: true, approvedById: params.approvedById, approvedAt: new Date() },
  });
}

export async function getApprovedHallOfFame(prisma: PrismaClient, month: string) {
  return prisma.hallOfFameEntry.findMany({
    where: { month, approved: true },
    include: { student: { include: { user: true } } },
    orderBy: { rank: "asc" },
  });
}
