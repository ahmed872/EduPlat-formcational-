import type { PrismaClient } from "@prisma/client";
import { isUniqueConstraintError } from "@/lib/prisma-errors";

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
    dedupeKey?: string;
  },
) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata as never,
      dedupeKey: params.dedupeKey,
    },
  });
}

/**
 * Evaluates whether the student just crossed 100% of a given period's
 * target for the first time in that period, and notifies once if so.
 * Called opportunistically after a heartbeat is recorded.
 *
 * The findFirst below is only a fast path; the real once-only guarantee is
 * the unique (userId, dedupeKey) index. Previously two near-simultaneous
 * heartbeats (e.g. a VIDEO and an EXERCISE one) could both pass the read
 * check and each create a notification.
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

  try {
    return await notify(prisma, {
      userId: params.userId,
      type: "TARGET_REACHED",
      title: `أحسنت! حققت هدفك ${periodLabel}`,
      body: `أنجزت ${params.achievedMinutes} دقيقة من أصل ${params.targetMinutes} دقيقة.`,
      metadata: { periodKey: params.periodKey, period: params.period },
      dedupeKey: `TARGET_REACHED:${params.period}:${params.periodKey}`,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return null;
    throw error;
  }
}
