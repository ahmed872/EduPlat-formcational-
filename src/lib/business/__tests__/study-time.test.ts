import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import {
  createCourse,
  createEntitlement,
  createExperiment,
  createLesson,
  createStudent,
  createSubscriptionPlan,
  createVideo,
} from "@/test/factories";
import {
  assertHeartbeatTargetIsReal,
  evaluateStreakForDay,
  recordHeartbeat,
} from "@/lib/business/study-time";
import { grantEntitlementsForSubscription } from "@/lib/business/video-access";
import { startExperimentAttempt, submitExperimentAttempt } from "@/lib/business/experiment";

beforeEach(async () => {
  await resetDatabase();
});

async function subscribeStudentToCourse(studentId: string, courseId: string) {
  const plan = await createSubscriptionPlan();
  await prisma.subscriptionPlanItem.create({ data: { planId: plan.id, courseId } });
  const subscription = await prisma.subscription.create({
    data: {
      studentId,
      planId: plan.id,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    },
  });
  await grantEntitlementsForSubscription(prisma, subscription.id);
}

describe("assertHeartbeatTargetIsReal", () => {
  it("rejects a completely fabricated video refId", async () => {
    // Regression test for a real bug: the heartbeat endpoint accepted ANY
    // client-supplied refId with no validation, letting a script fabricate
    // unlimited study time against a refId that doesn't even exist.
    const student = await createStudent();
    await expect(
      assertHeartbeatTargetIsReal(prisma, {
        studentId: student.id,
        type: "VIDEO",
        refId: "totally-made-up-video-id",
      }),
    ).rejects.toThrow(/access/);
  });

  it("rejects a real video the student is not entitled to", async () => {
    const student = await createStudent();
    const lesson = await createLesson();
    const video = await createVideo({ lessonId: lesson.id });

    await expect(
      assertHeartbeatTargetIsReal(prisma, {
        studentId: student.id,
        type: "VIDEO",
        refId: video.id,
      }),
    ).rejects.toThrow(/access/);
  });

  it("allows a real, entitled video", async () => {
    const student = await createStudent();
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id });
    const video = await createVideo({ lessonId: lesson.id });
    await subscribeStudentToCourse(student.id, course.id);

    await expect(
      assertHeartbeatTargetIsReal(prisma, {
        studentId: student.id,
        type: "VIDEO",
        refId: video.id,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a completely fabricated exercise refId", async () => {
    const student = await createStudent();
    await expect(
      assertHeartbeatTargetIsReal(prisma, {
        studentId: student.id,
        type: "EXERCISE",
        refId: "totally-made-up-experiment-id",
      }),
    ).rejects.toThrow(/access|exist/);
  });

  it("rejects a paid lesson's exercise for a non-entitled student", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ isFree: false });
    const experiment = await createExperiment({ lessonId: lesson.id });

    await expect(
      assertHeartbeatTargetIsReal(prisma, {
        studentId: student.id,
        type: "EXERCISE",
        refId: experiment.id,
      }),
    ).rejects.toThrow(/access/);
  });
});

describe("EXERCISE heartbeats require a live attempt", () => {
  const MINI_GAME = {
    v: 2,
    instructions: "x",
    questions: [
      { prompt: "a", choices: ["1", "2"], correctIndex: 0 },
      { prompt: "b", choices: ["1", "2"], correctIndex: 0 },
    ],
    lives: 1,
    timeLimitSeconds: 30,
    passScore: 1,
  };

  async function entitledExercise(config?: unknown) {
    const student = await createStudent();
    const lesson = await createLesson();
    await createEntitlement({ studentId: student.id, lessonId: lesson.id });
    const experiment = await createExperiment({
      lessonId: lesson.id,
      type: config ? "MINI_GAME" : undefined,
      config,
    });
    const beat = (now?: Date) =>
      assertHeartbeatTargetIsReal(prisma, { studentId: student.id, type: "EXERCISE", refId: experiment.id, now });
    return { student, lesson, experiment, beat };
  }

  it("rejects an accessible exercise that the student has not started", async () => {
    const { beat } = await entitledExercise();
    await expect(beat()).rejects.toThrow(/active exercise attempt/);
  });

  it("rejects a free lesson's exercise without an attempt, accepts it during one", async () => {
    const student = await createStudent();
    const lesson = await createLesson({ isFree: true });
    await createVideo({ lessonId: lesson.id, isFree: true });
    const experiment = await createExperiment({ lessonId: lesson.id });
    const beat = () =>
      assertHeartbeatTargetIsReal(prisma, { studentId: student.id, type: "EXERCISE", refId: experiment.id });
    await expect(beat()).rejects.toThrow(/active exercise attempt/);
    await startExperimentAttempt(prisma, { experimentId: experiment.id, studentId: student.id });
    await expect(beat()).resolves.toBeUndefined();
  });

  it("accepts heartbeats while an attempt is open and stops once it is completed", async () => {
    const { student, experiment, beat } = await entitledExercise();
    const attempt = await startExperimentAttempt(prisma, { experimentId: experiment.id, studentId: student.id });
    await expect(beat()).resolves.toBeUndefined();
    await submitExperimentAttempt(prisma, {
      attemptId: attempt.id,
      studentId: student.id,
      submission: { order: ["s1", "s2", "s3"] },
    });
    await expect(beat()).rejects.toThrow(/active exercise attempt/);
  });

  it("does not credit another student's open attempt", async () => {
    const { lesson, experiment, student } = await entitledExercise();
    await startExperimentAttempt(prisma, { experimentId: experiment.id, studentId: student.id });
    const other = await createStudent();
    await createEntitlement({ studentId: other.id, lessonId: lesson.id });
    await expect(
      assertHeartbeatTargetIsReal(prisma, { studentId: other.id, type: "EXERCISE", refId: experiment.id }),
    ).rejects.toThrow(/active exercise attempt/);
  });

  it("stops crediting an attempt left open for hours", async () => {
    const { student, experiment, beat } = await entitledExercise();
    const attempt = await startExperimentAttempt(prisma, { experimentId: experiment.id, studentId: student.id });
    await expect(beat(new Date(attempt.startedAt.getTime() + 60 * 60_000))).resolves.toBeUndefined();
    await expect(beat(new Date(attempt.startedAt.getTime() + 3 * 60 * 60_000))).rejects.toThrow(
      /active exercise attempt/,
    );
  });

  it("stops crediting a mini game once its round time is over", async () => {
    const { student, experiment, beat } = await entitledExercise(MINI_GAME);
    const attempt = await startExperimentAttempt(prisma, { experimentId: experiment.id, studentId: student.id });
    await expect(beat(new Date(attempt.startedAt.getTime() + 20_000))).resolves.toBeUndefined();
    await expect(beat(new Date(attempt.startedAt.getTime() + 60_000))).rejects.toThrow(/active exercise attempt/);
  });

  it("restarting after an expired round closes it and opens a fresh attempt", async () => {
    const { student, experiment, beat } = await entitledExercise(MINI_GAME);
    const first = await startExperimentAttempt(prisma, { experimentId: experiment.id, studentId: student.id });
    await prisma.experimentAttempt.update({
      where: { id: first.id },
      data: { startedAt: new Date(Date.now() - 5 * 60_000) },
    });
    await expect(beat()).rejects.toThrow(/active exercise attempt/);

    const second = await startExperimentAttempt(prisma, { experimentId: experiment.id, studentId: student.id });
    expect(second.id).not.toBe(first.id);
    const closed = await prisma.experimentAttempt.findUniqueOrThrow({ where: { id: first.id } });
    expect(closed.endedAt).not.toBeNull();
    expect(closed.completedAt).toBeNull();
    await expect(beat()).resolves.toBeUndefined();
  });

  it("rejects heartbeats once the lesson is unpublished, even mid-attempt", async () => {
    const { student, lesson, experiment, beat } = await entitledExercise();
    await startExperimentAttempt(prisma, { experimentId: experiment.id, studentId: student.id });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: "DRAFT" } });
    await expect(beat()).rejects.toThrow(/access/);
  });
});

describe("study-time heartbeat tracking", () => {
  it("counts active playback time across consecutive heartbeats", async () => {
    const student = await createStudent();
    const t0 = new Date("2026-09-18T10:00:00Z");

    await recordHeartbeat(prisma, {
      studentId: student.id,
      type: "VIDEO",
      refId: "video-1",
      now: t0,
    });
    // Heartbeats every 10s while the video keeps playing.
    await recordHeartbeat(prisma, {
      studentId: student.id,
      type: "VIDEO",
      refId: "video-1",
      now: new Date(t0.getTime() + 10_000),
    });
    await recordHeartbeat(prisma, {
      studentId: student.id,
      type: "VIDEO",
      refId: "video-1",
      now: new Date(t0.getTime() + 20_000),
    });

    const stat = await prisma.dailyStudyStat.findFirst({
      where: { studentId: student.id },
    });
    expect(stat?.videoSeconds).toBe(20);
    expect(stat?.totalActiveSeconds).toBe(20);
  });

  it("never double-credits the same elapsed gap under concurrent heartbeat requests", async () => {
    // Regression test for a real race: a plain read-then-write (findFirst
    // then update, even without an explicit lock) let two near-simultaneous
    // heartbeats for the same session both read the same lastHeartbeatAt
    // baseline and both credit the same elapsed gap, double-counting active
    // seconds that feed streaks/targets/achievements.
    const student = await createStudent();
    const t0 = new Date("2026-09-18T10:00:00Z");
    await recordHeartbeat(prisma, { studentId: student.id, type: "VIDEO", refId: "video-1", now: t0 });

    const nextTick = new Date(t0.getTime() + 10_000);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordHeartbeat(prisma, {
          studentId: student.id,
          type: "VIDEO",
          refId: "video-1",
          now: nextTick,
        }),
      ),
    );

    const totalCredited = results.reduce((sum, r) => sum + r.creditedSeconds, 0);
    expect(totalCredited).toBe(10); // the 10s gap credited exactly once, not 5 times

    const stat = await prisma.dailyStudyStat.findFirst({ where: { studentId: student.id } });
    expect(stat?.videoSeconds).toBe(10);
  });

  it("regression: parallel activities can't multiply real time (one wall clock per student)", async () => {
    // Before: each (type, refId) had its own clock, so a script sending
    // heartbeats for three videos and an exercise at once was credited 4×
    // the real elapsed time.
    const student = await createStudent();
    const t0 = new Date("2026-09-18T10:00:00Z");
    const refs = [
      { type: "VIDEO" as const, refId: "video-a" },
      { type: "VIDEO" as const, refId: "video-b" },
      { type: "VIDEO" as const, refId: "video-c" },
      { type: "EXERCISE" as const, refId: "exercise-a" },
    ];
    for (let step = 0; step <= 6; step++) {
      const now = new Date(t0.getTime() + step * 10_000);
      for (const r of refs) await recordHeartbeat(prisma, { studentId: student.id, ...r, now });
    }
    const stat = await prisma.dailyStudyStat.findFirst({ where: { studentId: student.id } });
    expect(stat?.totalActiveSeconds).toBe(60); // 60 real seconds, not 240
    expect((stat?.videoSeconds ?? 0) + (stat?.exerciseSeconds ?? 0)).toBe(60);
  });

  it("regression: concurrent heartbeats for different activities credit the wall clock once", async () => {
    const student = await createStudent();
    const t0 = new Date("2026-09-18T10:00:00Z");
    const refs = ["v1", "v2", "v3", "v4", "v5"];
    await Promise.all(refs.map((refId) => recordHeartbeat(prisma, { studentId: student.id, type: "VIDEO", refId, now: t0 })));
    const later = new Date(t0.getTime() + 20_000);
    await Promise.all(refs.map((refId) => recordHeartbeat(prisma, { studentId: student.id, type: "VIDEO", refId, now: later })));
    const stat = await prisma.dailyStudyStat.findFirst({ where: { studentId: student.id } });
    expect(stat?.totalActiveSeconds).toBe(20);
  });

  it("does not count time while the video is paused (heartbeats stop)", async () => {
    const student = await createStudent();
    const t0 = new Date("2026-09-18T10:00:00Z");

    await recordHeartbeat(prisma, {
      studentId: student.id,
      type: "VIDEO",
      refId: "video-1",
      now: t0,
    });
    await recordHeartbeat(prisma, {
      studentId: student.id,
      type: "VIDEO",
      refId: "video-1",
      now: new Date(t0.getTime() + 10_000),
    });

    // Student pauses for 5 minutes — no heartbeats are sent during the pause.
    const resumedAt = new Date(t0.getTime() + 10_000 + 5 * 60_000);
    const { creditedSeconds } = await recordHeartbeat(prisma, {
      studentId: student.id,
      type: "VIDEO",
      refId: "video-1",
      now: resumedAt,
    });

    // The 5-minute pause gap must not be credited.
    expect(creditedSeconds).toBe(0);

    const stat = await prisma.dailyStudyStat.findFirst({
      where: { studentId: student.id },
    });
    expect(stat?.videoSeconds).toBe(10);
  });

  it("does not count time while the tab is inactive / student idle", async () => {
    const student = await createStudent();
    const t0 = new Date("2026-09-18T10:00:00Z");

    await recordHeartbeat(prisma, {
      studentId: student.id,
      type: "EXERCISE",
      refId: "experiment-1",
      now: t0,
    });

    // Tab goes to background for an hour; client sends nothing during that time.
    const backAt = new Date(t0.getTime() + 60 * 60_000);
    await recordHeartbeat(prisma, {
      studentId: student.id,
      type: "EXERCISE",
      refId: "experiment-1",
      now: backAt,
    });

    const stat = await prisma.dailyStudyStat.findFirst({
      where: { studentId: student.id },
    });
    // Only the fresh session's own subsequent ticks would count — nothing yet.
    expect(stat?.exerciseSeconds ?? 0).toBe(0);
  });

  it("website simply being open with no activity never accrues time", async () => {
    const student = await createStudent();
    // No heartbeats sent at all — simulates an open-but-idle tab.
    const stat = await prisma.dailyStudyStat.findFirst({
      where: { studentId: student.id },
    });
    expect(stat).toBeNull();
  });

  it("builds a streak only on days meeting the minimum qualifying time", async () => {
    const student = await createStudent();
    const day1 = new Date("2026-09-18T10:00:00Z");
    const day2 = new Date("2026-09-19T10:00:00Z");

    // ~16.5 minutes of continuous heartbeats (10s apart) on day 1 (min qualifying = 15).
    for (let i = 0; i <= 100; i++) {
      await recordHeartbeat(prisma, {
        studentId: student.id,
        type: "VIDEO",
        refId: "video-1",
        now: new Date(day1.getTime() + i * 10_000),
      });
    }
    await evaluateStreakForDay(prisma, {
      studentId: student.id,
      day: day1,
      minQualifyingMinutes: 15,
    });

    for (let i = 0; i <= 100; i++) {
      await recordHeartbeat(prisma, {
        studentId: student.id,
        type: "VIDEO",
        refId: "video-1",
        now: new Date(day2.getTime() + i * 10_000),
      });
    }
    await evaluateStreakForDay(prisma, {
      studentId: student.id,
      day: day2,
      minQualifyingMinutes: 15,
    });

    const streak = await prisma.streak.findUnique({
      where: { studentId: student.id },
    });
    expect(streak?.currentStreak).toBe(2);
  });
});
