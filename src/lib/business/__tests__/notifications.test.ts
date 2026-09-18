import { beforeEach, describe, expect, it } from "vitest";
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
