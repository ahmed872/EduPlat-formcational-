import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function startOfWeek(date: Date) {
  const day = startOfDay(date);
  const diff = (day.getDay() + 6) % 7; // Monday-start week
  day.setDate(day.getDate() - diff);
  return day;
}
function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatMinutes(totalSeconds: number) {
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours > 0 ? `${hours}س ${remaining}د` : `${remaining}د`;
}

export default async function StudentDashboardPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const [entitlements, streak, dailyStats, target] = await Promise.all([
    prisma.entitlement.findMany({
      where: { studentId, revokedAt: null, lessonId: { not: null } },
      include: {
        lesson: {
          include: { course: true, video: true },
        },
      },
    }),
    prisma.streak.findUnique({ where: { studentId } }),
    prisma.dailyStudyStat.findMany({ where: { studentId } }),
    prisma.target.findFirst({
      where: { studentId, period: "WEEKLY", active: true },
    }),
  ]);

  const lessonIds = entitlements
    .map((e) => e.lessonId)
    .filter((id): id is string => Boolean(id));

  const progressRows = await prisma.lessonProgress.findMany({
    where: { studentId, lessonId: { in: lessonIds } },
  });
  const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));

  const now = new Date();
  const todaySeconds = dailyStats
    .filter((s) => s.date.getTime() === startOfDay(now).getTime())
    .reduce((sum, s) => sum + s.totalActiveSeconds, 0);
  const weekStart = startOfWeek(now);
  const weekSeconds = dailyStats
    .filter((s) => s.date.getTime() >= weekStart.getTime())
    .reduce((sum, s) => sum + s.totalActiveSeconds, 0);
  const monthStart = startOfMonth(now);
  const monthSeconds = dailyStats
    .filter((s) => s.date.getTime() >= monthStart.getTime())
    .reduce((sum, s) => sum + s.totalActiveSeconds, 0);

  const weeklyTargetMinutes = target?.targetMinutes ?? 0;
  const weeklyProgressPercent = weeklyTargetMinutes
    ? Math.min(100, Math.round((weekSeconds / 60 / weeklyTargetMinutes) * 100))
    : null;

  const courseGroups = new Map<
    string,
    { title: string; lessons: typeof entitlements }
  >();
  for (const entitlement of entitlements) {
    if (!entitlement.lesson) continue;
    const courseId = entitlement.lesson.courseId;
    if (!courseGroups.has(courseId)) {
      courseGroups.set(courseId, {
        title: entitlement.lesson.course.title,
        lessons: [],
      });
    }
    courseGroups.get(courseId)!.lessons.push(entitlement);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="مذاكرة اليوم" value={formatMinutes(todaySeconds)} />
        <StatCard label="مذاكرة الأسبوع" value={formatMinutes(weekSeconds)} />
        <StatCard label="مذاكرة الشهر" value={formatMinutes(monthSeconds)} />
        <StatCard
          label="سلسلة الأيام المتتالية"
          value={`${streak?.currentStreak ?? 0} يوم`}
        />
      </section>

      {weeklyProgressPercent !== null && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">
            الهدف الأسبوعي: {weeklyTargetMinutes} دقيقة — تم إنجاز{" "}
            {Math.round(weekSeconds / 60)} دقيقة
          </p>
          <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
            <div
              className="h-2 rounded-full bg-indigo-600"
              style={{ width: `${weeklyProgressPercent}%` }}
            />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">كورساتي</h2>
        {courseGroups.size === 0 && (
          <p className="text-sm text-gray-500">
            لا يوجد لديك اشتراك فعّال بعد. تصفح الكورسات المتاحة للاشتراك.
          </p>
        )}
        {Array.from(courseGroups.entries()).map(([courseId, group]) => (
          <div key={courseId} className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-semibold">{group.title}</h3>
            <ul className="flex flex-col gap-2">
              {group.lessons.map((entitlement) => {
                const lesson = entitlement.lesson!;
                const progress = progressByLesson.get(lesson.id);
                const status =
                  progress?.status === "COMPLETED"
                    ? "مكتمل"
                    : progress?.status === "IN_PROGRESS"
                      ? "قيد التقدم"
                      : "لم يبدأ";
                return (
                  <li
                    key={lesson.id}
                    className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2"
                  >
                    <span>{lesson.title}</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                        {status}
                      </span>
                      {lesson.video && (
                        <Link
                          href={`/student/videos/${lesson.video.id}`}
                          className="text-indigo-600 hover:underline"
                        >
                          مشاهدة
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
