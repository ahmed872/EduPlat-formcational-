import type { PrismaClient, StudyActivityType } from "@prisma/client";
import { checkVideoAccess } from "@/lib/business/video-access";
import { checkLessonAvailability } from "@/lib/business/content-visibility";
import { attemptExpired, resolveExperiment } from "@/lib/experiments/definitions";

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
 * The heartbeat endpoint credits real study time based only on cadence
 * (recordHeartbeat below) — without this check, it never validated that
 * `refId` refers to a real piece of content the student actually has a
 * reason to be engaging with. A script could otherwise POST here every
 * ~20s with a completely fabricated refId, indefinitely accumulating
 * activeSeconds that feed daily targets, streaks, and points/study-based
 * achievements with no real learning behind any of it. This does not need
 * to perfectly replicate every access rule — it only needs to reject a
 * refId with no legitimate relationship to the student at all.
 */
export async function assertHeartbeatTargetIsReal(
  prisma: PrismaClient,
  params: { studentId: string; type: StudyActivityType; refId: string; now?: Date },
): Promise<void> {
  if (params.type === "VIDEO") {
    const decision = await checkVideoAccess(prisma, {
      studentId: params.studentId,
      videoId: params.refId,
    });
    if (!decision.allowed) {
      throw new Error("Cannot record study time for a video you don't have access to");
    }
    return;
  }

  // EXERCISE — the lesson must still be available to the student (entitled
  // or free, published or archived-but-owned) AND the student must be in the
  // middle of a live attempt of this very exercise. Time is only credited
  // while an attempt is running, never for an exercise merely "opened".
  const experiment = await prisma.experiment.findUnique({
    where: { id: params.refId },
    select: { lessonId: true, type: true, config: true },
  });
  if (!experiment) {
    throw new Error("Cannot record study time for a non-existent exercise");
  }
  const availability = await checkLessonAvailability(prisma, {
    studentId: params.studentId,
    lessonId: experiment.lessonId,
  });
  if (!availability.allowed) {
    throw new Error("Cannot record study time for an exercise you don't have access to");
  }
  const resolved = resolveExperiment(experiment);
  const attempt = await prisma.experimentAttempt.findFirst({
    where: { experimentId: params.refId, studentId: params.studentId, completedAt: null, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!resolved || !attempt || attemptExpired(resolved, attempt.startedAt, params.now ?? new Date())) {
    throw new Error("Cannot record study time without an active exercise attempt");
  }
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
    // Optimistic-concurrency guard: the WHERE clause repeats the exact
    // lastHeartbeatAt just read, so the update only applies if nothing else
    // has touched this session since. Without it, two near-simultaneous
    // heartbeat requests (a client retry, a duplicated network request) for
    // the same session both read the same baseline and would otherwise both
    // credit the same elapsed gap, double-counting active seconds.
    const applied = await prisma.studyActivitySession.updateMany({
      where: { id: openSession.id, lastHeartbeatAt: openSession.lastHeartbeatAt },
      data: {
        lastHeartbeatAt: now,
        activeSeconds: { increment: creditedSeconds },
      },
    });
    if (applied.count === 0) {
      // Lost the race to a concurrent heartbeat — that other request already
      // credited this exact gap, so this one credits nothing further.
      creditedSeconds = 0;
    }
    session = await prisma.studyActivitySession.findUniqueOrThrow({
      where: { id: openSession.id },
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
