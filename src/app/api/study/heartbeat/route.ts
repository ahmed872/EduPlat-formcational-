import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, toErrorResponse } from "@/lib/rbac";
import { assertHeartbeatTargetIsReal, evaluateStreakForDay, recordHeartbeat } from "@/lib/business/study-time";
import { notifyIfTargetReached } from "@/lib/business/notifications";
import { evaluateAchievementsForStudent } from "@/lib/business/achievements";
import { getPlatformSetting, PLATFORM_SETTING_KEYS } from "@/lib/platform-settings";

const bodySchema = z.object({
  type: z.enum(["VIDEO", "EXERCISE"]),
  refId: z.string(),
});

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { type, refId } = bodySchema.parse(await request.json());
    const studentId = session.user.studentProfileId!;

    await assertHeartbeatTargetIsReal(prisma, { studentId, type, refId });
    const result = await recordHeartbeat(prisma, { studentId, type, refId });

    if (result.creditedSeconds > 0) {
      const today = startOfDay(new Date());
      const [dailyStat, target, minQualifyingMinutes] = await Promise.all([
        prisma.dailyStudyStat.findUnique({
          where: { studentId_date: { studentId, date: today } },
        }),
        prisma.target.findFirst({
          where: { OR: [{ studentId }, { studentId: null }], period: "DAILY", active: true },
          orderBy: { studentId: "desc" }, // student-specific (non-null) sorts first
        }),
        getPlatformSetting<number>(PLATFORM_SETTING_KEYS.DAILY_STREAK_MIN_ACTIVE_MINUTES),
      ]);
      if (target && dailyStat) {
        await notifyIfTargetReached(prisma, {
          studentId,
          userId: session.user.id,
          period: "DAILY",
          achievedMinutes: Math.round(dailyStat.totalActiveSeconds / 60),
          targetMinutes: target.targetMinutes,
          periodKey: today.toISOString().slice(0, 10),
        });
      }
      await evaluateStreakForDay(prisma, { studentId, day: today, minQualifyingMinutes });
      await evaluateAchievementsForStudent(prisma, studentId);
    }

    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
