import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PUBLISHED_LESSON_WHERE, effectiveContentState } from "@/lib/business/content-visibility";

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

  const [entitlements, streak, dailyStats, targets, recentSessions, freeLessons] =
    await Promise.all([
      // Unpublished (DRAFT) lessons/courses are hidden from everyone, even
      // students who own them; archived ones stay listed for their owners.
      prisma.entitlement.findMany({
        where: {
          studentId,
          revokedAt: null,
          lesson: { status: { not: "DRAFT" }, course: { status: { not: "DRAFT" } } },
        },
        include: {
          lesson: {
            include: { course: true, video: true },
          },
        },
      }),
      prisma.streak.findUnique({ where: { studentId } }),
      prisma.dailyStudyStat.findMany({ where: { studentId } }),
      prisma.target.findMany({
        where: { OR: [{ studentId }, { studentId: null }], active: true },
      }),
      prisma.watchSession.findMany({
        where: { studentId },
        orderBy: { startedAt: "desc" },
        take: 5,
        include: { video: { include: { lesson: { include: { course: true } } } } },
      }),
      // Free lessons are accessible to every student regardless of any
      // subscription/entitlement (see checkVideoAccess's FREE_VIDEO rule),
      // so they must be surfaced here independently of the entitlement list
      // above — otherwise a student would have no way to discover them.
      prisma.lesson.findMany({
        where: {
          ...PUBLISHED_LESSON_WHERE,
          isFree: true,
          video: { isFree: true, status: "PUBLISHED" },
        },
        include: { course: true, video: true },
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

  function pickTarget(period: "DAILY" | "WEEKLY" | "MONTHLY") {
    const studentSpecific = targets.find((t) => t.studentId === studentId && t.period === period);
    const global = targets.find((t) => t.studentId === null && t.period === period);
    return studentSpecific ?? global ?? null;
  }

  const targetRows: Array<{ label: string; seconds: number; period: "DAILY" | "WEEKLY" | "MONTHLY" }> = [
    { label: "الهدف اليومي", seconds: todaySeconds, period: "DAILY" },
    { label: "الهدف الأسبوعي", seconds: weekSeconds, period: "WEEKLY" },
    { label: "الهدف الشهري", seconds: monthSeconds, period: "MONTHLY" },
  ];

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
    const group = courseGroups.get(courseId)!;
    if (!group.lessons.some((e) => e.lesson!.id === entitlement.lesson!.id)) {
      group.lessons.push(entitlement);
    }
  }

  // "Continue watching": most recently watched video whose lesson isn't completed.
  const continueWatching = recentSessions.find((watchSession) => {
    const lessonId = watchSession.video.lesson?.id;
    if (!lessonId) return false;
    const state = effectiveContentState(
      watchSession.video.status,
      watchSession.video.lesson?.status,
      watchSession.video.lesson?.course.status,
    );
    if (state === "HIDDEN") return false;
    return progressByLesson.get(lessonId)?.status !== "COMPLETED";
  });

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

      <section className="grid gap-3 sm:grid-cols-3">
        {targetRows.map(({ label, seconds, period }) => {
          const target = pickTarget(period);
          if (!target) return null;
          const percent = Math.min(
            100,
            Math.round((seconds / 60 / target.targetMinutes) * 100),
          );
          return (
            <div key={period} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-600">
                {label}: {target.targetMinutes} دقيقة — تم {Math.round(seconds / 60)} دقيقة
              </p>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full bg-indigo-600"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </section>

      {continueWatching && (
        <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
          <p className="text-sm text-indigo-700">متابعة المشاهدة من حيث توقفت</p>
          <div className="mt-2 flex items-center justify-between">
            <div>
              <p className="font-semibold">
                {continueWatching.video.lesson?.title ?? continueWatching.video.title}
              </p>
              <p className="text-xs text-gray-500">
                {continueWatching.video.lesson?.course.title}
              </p>
            </div>
            <Link
              href={`/student/videos/${continueWatching.video.id}`}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
            >
              متابعة
            </Link>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">كورساتي</h2>
          <Link href="/student/history" className="text-sm text-indigo-600 hover:underline">
            سجل التعلم
          </Link>
        </div>
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
                    <span>
                      {lesson.title}
                      {effectiveContentState(lesson.status, lesson.course.status) === "ARCHIVED" && (
                        <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                          مؤرشف
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                        {status}
                      </span>
                      {lesson.video && lesson.video.status !== "DRAFT" && (
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

      {freeLessons.some((lesson) => !lessonIds.includes(lesson.id)) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">دروس مجانية متاحة للجميع</h2>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <ul className="flex flex-col gap-2">
              {freeLessons
                .filter((lesson) => !lessonIds.includes(lesson.id))
                .map((lesson) => (
                  <li
                    key={lesson.id}
                    className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2"
                  >
                    <div>
                      <span>{lesson.title}</span>
                      <span className="ms-2 text-xs text-gray-500">({lesson.course.title})</span>
                    </div>
                    {lesson.video && (
                      <Link
                        href={`/student/videos/${lesson.video.id}`}
                        className="text-sm text-indigo-600 hover:underline"
                      >
                        مشاهدة
                      </Link>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        </section>
      )}
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
