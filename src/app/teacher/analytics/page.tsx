import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCourseAnalyticsForTeacher } from "@/lib/business/analytics";

export default async function TeacherAnalyticsPage() {
  const courses = await prisma.course.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
  });

  const analytics = await Promise.all(
    courses.map((course) => getCourseAnalyticsForTeacher(prisma, course.id)),
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">تحليلات الكورسات</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {analytics.map((a) => (
          <Link
            key={a.courseId}
            href={`/teacher/analytics/${a.courseId}`}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300"
          >
            <p className="font-semibold">{a.courseTitle}</p>
            <p className="mt-1 text-xs text-gray-500">
              {a.enrolledStudentsCount} طالب مشترك · متوسط الإكمال{" "}
              {a.averageCompletionPercentage.toFixed(0)}%
              {a.averageQuizPercentage !== null &&
                ` · متوسط الاختبارات ${a.averageQuizPercentage.toFixed(0)}%`}
            </p>
          </Link>
        ))}
        {analytics.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد كورسات منشورة بعد.</p>
        )}
      </div>
    </div>
  );
}
