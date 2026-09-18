import type { PrismaClient, StudyActivityType } from "@prisma/client";

/**
 * Any gap between heartbeats larger than this is treated as the student
 * having gone idle, paused, backgrounded the tab, or left the device — the
 * gap itself is never credited as study time, and the next heartbeat starts
 * a fresh activity session instead of "closing the gap".
 */
const HEARTBEAT_MAX_GAP_SECONDS = 30;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Called by the client ONLY while it believes real learning activity is
 * happening right now (video.play + tab visible, or active exercise
 * interaction). The client must stop calling this the instant the video is
 * paused, the tab is hidden/backgrounded, or the user goes idle — the server
 * has no way to see the player state directly, so it trusts cadence: a
 * missing heartbeat is what makes time NOT count.
 */
export async function recordHeartbeat(
  prisma: PrismaClient,
  params: {
    studentId: string;
    type: StudyActivityType;
    refId: string;
    now?: Date;
  },
) {
  const now = params.now ?? new Date();

  const openSession = await prisma.studyActivitySession.findFirst({
    where: { studentId: params.studentId, type: params.type, refId: params.refId },
    orderBy: { lastHeartbeatAt: "desc" },
  });

  const gapSeconds = openSession
    ? (now.getTime() - openSession.lastHeartbeatAt.getTime()) / 1000
    : Infinity;

  let creditedSeconds = 0;
  let session;

  if (!openSession || gapSeconds > HEARTBEAT_MAX_GAP_SECONDS) {
    // Fresh session: nothing to credit yet, this heartbeat just marks start.
    session = await prisma.studyActivitySession.create({
      data: {
        studentId: params.studentId,
        type: params.type,
        refId: params.refId,
        startedAt: now,
        lastHeartbeatAt: now,
        activeSeconds: 0,
      },
    });
  } else {
    creditedSeconds = Math.max(0, gapSeconds);
    session = await prisma.studyActivitySession.update({
      where: { id: openSession.id },
      data: {
        lastHeartbeatAt: now,
        activeSeconds: { increment: creditedSeconds },
      },
    });
  }

  if (creditedSeconds > 0) {
    await applyDailyStudyCredit(prisma, {
      studentId: params.studentId,
      type: params.type,
      seconds: creditedSeconds,
      day: now,
    });
  }

  return { session, creditedSeconds };
}

async function applyDailyStudyCredit(
  prisma: PrismaClient,
  params: {
    studentId: string;
    type: StudyActivityType;
    seconds: number;
    day: Date;
  },
) {
  const date = startOfDay(params.day);
  const videoSeconds = params.type === "VIDEO" ? params.seconds : 0;
  const exerciseSeconds = params.type === "EXERCISE" ? params.seconds : 0;

  await prisma.dailyStudyStat.upsert({
    where: { studentId_date: { studentId: params.studentId, date } },
    create: {
      studentId: params.studentId,
      date,
      videoSeconds,
      exerciseSeconds,
      totalActiveSeconds: params.seconds,
    },
    update: {
      videoSeconds: { increment: videoSeconds },
      exerciseSeconds: { increment: exerciseSeconds },
      totalActiveSeconds: { increment: params.seconds },
    },
  });
}

/**
 * Evaluates today's accumulated active time against the configured minimum
 * and extends/resets the streak accordingly. Meant to be called once per
 * day (e.g. end-of-day job or on first heartbeat of a new day), not on
 * every heartbeat.
 */
export async function evaluateStreakForDay(
  prisma: PrismaClient,
  params: { studentId: string; day: Date; minQualifyingMinutes: number },
) {
  const date = startOfDay(params.day);
  const stat = await prisma.dailyStudyStat.findUnique({
    where: { studentId_date: { studentId: params.studentId, date } },
  });
  const qualifies =
    (stat?.totalActiveSeconds ?? 0) >= params.minQualifyingMinutes * 60;
  if (!qualifies) return;

  const streak = await prisma.streak.findUnique({
    where: { studentId: params.studentId },
  });

  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);

  if (!streak) {
    return prisma.streak.create({
      data: {
        studentId: params.studentId,
        currentStreak: 1,
        longestStreak: 1,
        lastQualifyingDate: date,
      },
    });
  }

  if (
    streak.lastQualifyingDate &&
    streak.lastQualifyingDate.getTime() === date.getTime()
  ) {
    return streak; // already counted today
  }

  const continuesStreak =
    streak.lastQualifyingDate &&
    streak.lastQualifyingDate.getTime() === yesterday.getTime();

  const currentStreak = continuesStreak ? streak.currentStreak + 1 : 1;

  return prisma.streak.update({
    where: { studentId: params.studentId },
    data: {
      currentStreak,
      longestStreak: Math.max(streak.longestStreak, currentStreak),
      lastQualifyingDate: date,
    },
  });
}
