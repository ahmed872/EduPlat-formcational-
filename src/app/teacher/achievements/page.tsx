import { prisma } from "@/lib/prisma";
import { ACHIEVEMENT_METRICS, type AchievementCriteria } from "@/lib/business/achievements";
import { createAchievement, awardAchievement } from "./actions";

const METRIC_LABELS: Record<string, string> = {
  STREAK_DAYS: "أطول سلسلة أيام مذاكرة متواصلة",
  LESSONS_COMPLETED: "عدد الدروس المكتملة",
  QUIZZES_PASSED: "عدد الاختبارات الناجحة",
  EXPERIMENTS_COMPLETED: "عدد التجارب المكتملة",
  GAME_POINTS: "إجمالي نقاط الألعاب",
};

export default async function TeacherAchievementsPage() {
  const [achievements, students] = await Promise.all([
    prisma.achievement.findMany({
      include: { studentAchievements: { include: { student: { include: { user: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.studentProfile.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الإنجازات</h1>
        <p className="mt-1 text-sm text-gray-600">
          الإنجازات الآلية تُمنح تلقائيًا فور تحقيق الطالب لشرطها الحقيقي (سلسلة
          مذاكرة، دروس، اختبارات، تجارب، أو نقاط ألعاب) — لا يمكن منحها يدويًا.
          الإنجازات الخاصة تُمنح فقط بقرار المعلم لتقدير لا يمكن قياسه آليًا.
        </p>
      </div>

      <form
        action={createAchievement}
        className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <h2 className="font-semibold">إضافة إنجاز جديد</h2>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">الرمز</span>
            <input
              name="code"
              required
              placeholder="STREAK_7"
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">العنوان</span>
            <input
              name="title"
              required
              placeholder="أسبوع مذاكرة متواصل"
              className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">الأيقونة (اختياري)</span>
            <input name="icon" placeholder="🔥" className="w-20 rounded-md border border-gray-300 px-3 py-2" />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الوصف (اختياري)</span>
          <input name="description" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isCustom" className="rounded border-gray-300" />
          إنجاز خاص (يُمنح يدويًا فقط، بلا شرط آلي)
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">المقياس (للإنجاز الآلي فقط)</span>
            <select name="metric" className="min-w-56 rounded-md border border-gray-300 px-3 py-2">
              {ACHIEVEMENT_METRICS.map((metric) => (
                <option key={metric} value={metric}>
                  {METRIC_LABELS[metric]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">الحد المطلوب</span>
            <input
              type="number"
              name="threshold"
              min={1}
              placeholder="7"
              className="w-28 rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            إضافة
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        {achievements.map((achievement) => {
          const criteria = achievement.criteriaJson as AchievementCriteria;
          return (
            <div key={achievement.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">
                  {achievement.icon ? `${achievement.icon} ` : ""}
                  {achievement.title}
                </p>
                {achievement.isCustom ? (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                    خاص
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    آلي: {METRIC_LABELS[criteria.metric] ?? criteria.metric} ≥ {criteria.threshold}
                  </span>
                )}
              </div>
              {achievement.description && (
                <p className="mt-1 text-sm text-gray-600">{achievement.description}</p>
              )}

              <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                {achievement.studentAchievements.length === 0 ? (
                  <span>لم يحصل عليه أي طالب بعد.</span>
                ) : (
                  achievement.studentAchievements.map((sa) => (
                    <span key={sa.id} className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                      {sa.student.user.name}
                    </span>
                  ))
                )}
              </div>

              {achievement.isCustom && (
                <form
                  action={awardAchievement.bind(null, achievement.id)}
                  className="mt-3 flex items-end gap-2"
                >
                  <select
                    name="studentId"
                    required
                    className="min-w-56 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">اختر طالبًا لمنحه هذا الإنجاز</option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.user.name} ({student.user.email})
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700"
                  >
                    منح
                  </button>
                </form>
              )}
            </div>
          );
        })}
        {achievements.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد إنجازات بعد.</p>
        )}
      </div>
    </div>
  );
}
