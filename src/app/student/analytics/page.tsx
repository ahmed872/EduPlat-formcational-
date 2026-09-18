import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStudentOverallAnalytics } from "@/lib/business/analytics";

function formatHours(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}س ${minutes}د` : `${minutes}د`;
}

export default async function StudentAnalyticsPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const analytics = await getStudentOverallAnalytics(prisma, studentId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-bold">تحليلاتي</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">إجمالي وقت المذاكرة</p>
          <p className="mt-1 text-2xl font-bold">{formatHours(analytics.totalStudySeconds)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">دروس مكتملة</p>
          <p className="mt-1 text-2xl font-bold">{analytics.totalLessonsCompleted}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">اختبارات ناجحة</p>
          <p className="mt-1 text-2xl font-bold">
            {analytics.totalQuizzesPassed} / {analytics.totalQuizzesTaken}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">تجارب مكتملة</p>
          <p className="mt-1 text-2xl font-bold">{analytics.totalExperimentsCompleted}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-xl font-bold">تقدمي في كل كورس</h2>
        <div className="flex flex-col gap-3">
          {analytics.courses.map((course) => (
            <div key={course.courseId} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{course.courseTitle}</p>
                <span className="text-sm text-gray-500">
                  {course.completedLessons} / {course.totalLessons} دروس
                </span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full bg-indigo-600"
                  style={{ width: `${course.completionPercentage}%` }}
                />
              </div>
              {course.quizzesTaken > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  متوسط درجات الاختبارات: {course.averageQuizPercentage?.toFixed(0)}% · نسبة
                  النجاح: {course.quizPassRate?.toFixed(0)}%
                </p>
              )}
            </div>
          ))}
          {analytics.courses.length === 0 && (
            <p className="text-sm text-gray-500">لا يوجد لديك دروس متاحة بعد لعرض تقدمك فيها.</p>
          )}
        </div>
      </div>
    </div>
  );
}
