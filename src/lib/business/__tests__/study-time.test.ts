import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import { evaluateStreakForDay, recordHeartbeat } from "@/lib/business/study-time";

beforeEach(async () => {
  await resetDatabase();
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
