import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStudentAchievements } from "@/lib/business/achievements";

const METRIC_LABELS: Record<string, string> = {
  STREAK_DAYS: "أطول سلسلة أيام مذاكرة متواصلة",
  LESSONS_COMPLETED: "دروس مكتملة",
  QUIZZES_PASSED: "اختبارات ناجحة",
  EXPERIMENTS_COMPLETED: "تجارب مكتملة",
  GAME_POINTS: "نقاط الألعاب",
};

export default async function StudentAchievementsPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const entries = await getStudentAchievements(prisma, studentId);
  const earned = entries.filter((e) => e.earnedAt);
  const locked = entries.filter((e) => !e.earnedAt);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">إنجازاتي</h1>
        <p className="mt-1 text-sm text-gray-600">
          كل إنجاز يُمنح تلقائيًا فور تحقيقه فعليًا — لا يوجد إنجاز صوري.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold">تم إنجازها ({earned.length})</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {earned.map(({ achievement, earnedAt }) => (
            <div
              key={achievement.id}
              className="flex flex-col items-center gap-1 rounded-lg border border-green-200 bg-green-50 p-3 text-center"
            >
              <span className="text-3xl">{achievement.icon ?? "🏆"}</span>
              <p className="text-sm font-semibold">{achievement.title}</p>
              {achievement.description && (
                <p className="text-xs text-gray-500">{achievement.description}</p>
              )}
              <p className="text-[10px] text-gray-400">
                {earnedAt!.toLocaleDateString("ar-EG")}
              </p>
            </div>
          ))}
          {earned.length === 0 && (
            <p className="col-span-full text-sm text-gray-500">
              لم تحصل على أي إنجاز بعد — واصل المذاكرة وحل الاختبارات لتحصل على أول إنجاز!
            </p>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold">لم تُنجز بعد ({locked.length})</h2>
        <div className="flex flex-col gap-2">
          {locked.map(({ achievement, progress }) => (
            <div
              key={achievement.id}
              className="rounded-lg border border-gray-200 bg-white p-3 opacity-70"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl grayscale">{achievement.icon ?? "🔒"}</span>
                <p className="text-sm font-semibold">{achievement.title}</p>
              </div>
              {achievement.description && (
                <p className="mt-1 text-xs text-gray-500">{achievement.description}</p>
              )}
              {progress && (
                <>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
                    <div
                      className="h-1.5 rounded-full bg-indigo-400"
                      style={{
                        width: `${Math.min(100, (progress.current / progress.threshold) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">
                    {METRIC_LABELS[
                      (achievement.criteriaJson as { metric: string }).metric
                    ] ?? ""}
                    : {progress.current} / {progress.threshold}
                  </p>
                </>
              )}
              {!progress && (
                <p className="mt-1 text-[11px] text-gray-400">إنجاز خاص — يُمنح من المعلم.</p>
              )}
            </div>
          ))}
          {locked.length === 0 && (
            <p className="text-sm text-gray-500">حصلت على كل الإنجازات المتاحة حاليًا!</p>
          )}
        </div>
      </div>
    </div>
  );
}
