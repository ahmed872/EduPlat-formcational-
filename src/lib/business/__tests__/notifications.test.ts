import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import { notify, notifyIfTargetReached } from "@/lib/business/notifications";

beforeEach(async () => {
  await resetDatabase();
});

describe("notify", () => {
  it("creates a notification for the given user", async () => {
    const student = await createStudent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });

    await notify(prisma, {
      userId: user.id,
      type: "TEST",
      title: "عنوان",
      body: "نص",
    });

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].readAt).toBeNull();
  });
});

describe("notifyIfTargetReached", () => {
  it("notifies once when the target is reached", async () => {
    const student = await createStudent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });

    const result = await notifyIfTargetReached(prisma, {
      studentId: student.id,
      userId: user.id,
      period: "DAILY",
      achievedMinutes: 30,
      targetMinutes: 30,
      periodKey: "2026-09-18",
    });
    expect(result).not.toBeNull();

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id, type: "TARGET_REACHED" },
    });
    expect(notifications).toHaveLength(1);
  });

  it("does not notify twice for the same day", async () => {
    const student = await createStudent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });

    await notifyIfTargetReached(prisma, {
      studentId: student.id,
      userId: user.id,
      period: "DAILY",
      achievedMinutes: 30,
      targetMinutes: 30,
      periodKey: "2026-09-18",
    });
    const second = await notifyIfTargetReached(prisma, {
      studentId: student.id,
      userId: user.id,
      period: "DAILY",
      achievedMinutes: 40,
      targetMinutes: 30,
      periodKey: "2026-09-18",
    });
    expect(second).toBeNull();

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id, type: "TARGET_REACHED" },
    });
    expect(notifications).toHaveLength(1);
  });

  it("does not notify when below target", async () => {
    const student = await createStudent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });

    const result = await notifyIfTargetReached(prisma, {
      studentId: student.id,
      userId: user.id,
      period: "DAILY",
      achievedMinutes: 10,
      targetMinutes: 30,
      periodKey: "2026-09-18",
    });
    expect(result).toBeNull();
  });
});

// Final audit gap #3: the once-per-day check was a plain read followed by a
// create, so several near-simultaneous heartbeats (e.g. one VIDEO and one
// EXERCISE crediting at the same instant) could all pass it and each fire
// a TARGET_REACHED notification.
describe("notifyIfTargetReached under concurrency", () => {
  it("does not duplicate when a second call's read ran before the first call's insert (the race, reproduced deterministically)", async () => {
    const student = await createStudent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
    const params = {
      studentId: student.id,
      userId: user.id,
      period: "DAILY" as const,
      achievedMinutes: 30,
      targetMinutes: 30,
      periodKey: "2026-09-24",
    };
    // What the losing request of a real race sees: its "already notified?"
    // read executed before the winner's insert committed, so it read nothing.
    const staleReadClient = prisma.$extends({
      query: { notification: { findFirst: async () => null } },
    }) as unknown as PrismaClient;

    const first = await notifyIfTargetReached(prisma, params);
    const second = await notifyIfTargetReached(staleReadClient, params);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(
      await prisma.notification.count({ where: { userId: user.id, type: "TARGET_REACHED" } }),
    ).toBe(1);
  });

  it("creates exactly one notification when many calls race for the same day", async () => {
    const student = await createStudent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        notifyIfTargetReached(prisma, {
          studentId: student.id,
          userId: user.id,
          period: "DAILY",
          achievedMinutes: 30 + i,
          targetMinutes: 30,
          periodKey: "2026-09-24",
        }),
      ),
    );

    // Losers resolve to null — none of them throws at the caller.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(results.filter((r) => r.status === "fulfilled" && r.value !== null)).toHaveLength(1);
    expect(
      await prisma.notification.count({ where: { userId: user.id, type: "TARGET_REACHED" } }),
    ).toBe(1);
  });

  it("still notifies again on a new day, and never blocks unrelated notifications", async () => {
    const student = await createStudent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
    const base = { studentId: student.id, userId: user.id, period: "DAILY" as const, achievedMinutes: 30, targetMinutes: 30 };

    await notifyIfTargetReached(prisma, { ...base, periodKey: "2026-09-24" });
    await notifyIfTargetReached(prisma, { ...base, periodKey: "2026-09-25" });
    await notify(prisma, { userId: user.id, type: "OTHER", title: "a" });
    await notify(prisma, { userId: user.id, type: "OTHER", title: "b" });

    expect(await prisma.notification.count({ where: { userId: user.id, type: "TARGET_REACHED" } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: user.id, type: "OTHER" } })).toBe(2);
  });
});
