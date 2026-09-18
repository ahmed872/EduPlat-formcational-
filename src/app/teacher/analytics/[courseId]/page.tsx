import { notFound } from "next/navigation";
import { getCourseAnalyticsForTeacher } from "@/lib/business/analytics";
import { prisma } from "@/lib/prisma";

export default async function CourseAnalyticsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) notFound();

  const analytics = await getCourseAnalyticsForTeacher(prisma, courseId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{analytics.courseTitle}</h1>
        <p className="text-sm text-gray-600">تحليلات الأداء لهذا الكورس</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">الطلاب المشتركون</p>
          <p className="mt-1 text-2xl font-bold">{analytics.enrolledStudentsCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">متوسط نسبة الإكمال</p>
          <p className="mt-1 text-2xl font-bold">
            {analytics.averageCompletionPercentage.toFixed(0)}%
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">متوسط درجات الاختبارات</p>
          <p className="mt-1 text-2xl font-bold">
            {analytics.averageQuizPercentage !== null
              ? `${analytics.averageQuizPercentage.toFixed(0)}%`
              : "—"}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">نسبة إكمال الطلاب لكل درس</h2>
        <ul className="flex flex-col gap-2">
          {analytics.lessonFunnel.map((lesson) => (
            <li key={lesson.lessonId} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span>{lesson.title}</span>
                <span className="text-gray-500">
                  {lesson.completedCount} / {analytics.enrolledStudentsCount} (
                  {lesson.completionRate.toFixed(0)}%)
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full bg-indigo-600"
                  style={{ width: `${lesson.completionRate}%` }}
                />
              </div>
            </li>
          ))}
          {analytics.lessonFunnel.length === 0 && (
            <li className="text-sm text-gray-500">لا توجد دروس منشورة في هذا الكورس بعد.</li>
          )}
        </ul>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">الطالب</th>
              <th className="px-4 py-2">نسبة الإكمال</th>
              <th className="px-4 py-2">متوسط درجات الاختبارات</th>
            </tr>
          </thead>
          <tbody>
            {analytics.students.map((student) => (
              <tr key={student.studentId} className="border-t border-gray-100">
                <td className="px-4 py-2">{student.name}</td>
                <td className="px-4 py-2">{student.completionPercentage.toFixed(0)}%</td>
                <td className="px-4 py-2">
                  {student.averageQuizPercentage !== null
                    ? `${student.averageQuizPercentage.toFixed(0)}%`
                    : "—"}
                </td>
              </tr>
            ))}
            {analytics.students.length === 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-500" colSpan={3}>
                  لا يوجد طلاب مشتركون بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
