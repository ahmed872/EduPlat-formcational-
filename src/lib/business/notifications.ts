import type { PrismaClient } from "@prisma/client";

/**
 * Every in-app notification in the platform is created through this one
 * function, so the shape stays consistent and future delivery channels
 * (email/push) have a single place to hook into later — see
 * PROJECT_STATUS.md.
 */
export async function notify(
  prisma: PrismaClient,
  params: {
    userId: string;
    type: string;
    title: string;
    body?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata as never,
    },
  });
}

/**
 * Evaluates whether the student just crossed 100% of a given period's
 * target for the first time today, and notifies once (idempotent per
 * calendar day via a metadata check) if so. Called opportunistically
 * after a heartbeat is recorded.
 */
export async function notifyIfTargetReached(
  prisma: PrismaClient,
  params: {
    studentId: string;
    userId: string;
    period: "DAILY" | "WEEKLY" | "MONTHLY";
    achievedMinutes: number;
    targetMinutes: number;
    periodKey: string; // e.g. "2026-09-18" for DAILY, used for de-duplication
  },
) {
  if (params.achievedMinutes < params.targetMinutes) return null;

  const alreadyNotifiedToday = await prisma.notification.findFirst({
    where: {
      userId: params.userId,
      type: "TARGET_REACHED",
      metadata: { path: ["periodKey"], equals: params.periodKey } as never,
    },
  });
  if (alreadyNotifiedToday) return null;

  const periodLabel =
    params.period === "DAILY" ? "اليومي" : params.period === "WEEKLY" ? "الأسبوعي" : "الشهري";

  return notify(prisma, {
    userId: params.userId,
    type: "TARGET_REACHED",
    title: `أحسنت! حققت هدفك ${periodLabel}`,
    body: `أنجزت ${params.achievedMinutes} دقيقة من أصل ${params.targetMinutes} دقيقة.`,
    metadata: { periodKey: params.periodKey, period: params.period },
  });
}
