import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, toErrorResponse } from "@/lib/rbac";
import { recordHeartbeat } from "@/lib/business/study-time";
import { notifyIfTargetReached } from "@/lib/business/notifications";

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

    const result = await recordHeartbeat(prisma, { studentId, type, refId });

    if (result.creditedSeconds > 0) {
      const today = startOfDay(new Date());
      const [dailyStat, target] = await Promise.all([
        prisma.dailyStudyStat.findUnique({
          where: { studentId_date: { studentId, date: today } },
        }),
        prisma.target.findFirst({
          where: { OR: [{ studentId }, { studentId: null }], period: "DAILY", active: true },
          orderBy: { studentId: "desc" }, // student-specific (non-null) sorts first
        }),
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
    }

    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
