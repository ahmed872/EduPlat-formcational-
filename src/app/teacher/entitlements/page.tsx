import { prisma } from "@/lib/prisma";
import { grantEntitlementAction } from "./actions";

export default async function TeacherEntitlementsPage() {
  const [courses, recentGrants] = await Promise.all([
    prisma.course.findMany({
      include: { lessons: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.entitlement.findMany({
      where: { reason: "ADMIN_GRANT" },
      include: { student: { include: { user: true } }, lesson: true },
      orderBy: { grantedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">منح وصول استثنائي</h1>
        <p className="mt-1 text-sm text-gray-600">
          امنح طالبًا محددًا وصولًا لدرس واحد نُشر بعد اشتراكه — دون الحاجة
          لاشتراك جديد. كل منح مسجّل ومرتبط باسمك.
        </p>
      </div>

      <form
        action={grantEntitlementAction}
        className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-end sm:flex-wrap"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600">البريد الإلكتروني للطالب</span>
          <input
            type="email"
            name="studentEmail"
            required
            className="w-64 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600">الدرس</span>
          <select
            name="lessonId"
            required
            className="w-64 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">اختر درسًا</option>
            {courses.map((course) => (
              <optgroup key={course.id} label={course.title}>
                {course.lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600">تاريخ انتهاء (اختياري)</span>
          <input
            type="date"
            name="expiresAt"
            className="w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          منح الوصول
        </button>
      </form>

      <div>
        <h2 className="mb-3 text-lg font-semibold">آخر عمليات المنح</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-right text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">الطالب</th>
                <th className="px-4 py-2">الدرس</th>
                <th className="px-4 py-2">تاريخ المنح</th>
                <th className="px-4 py-2">تاريخ الانتهاء</th>
              </tr>
            </thead>
            <tbody>
              {recentGrants.map((grant) => (
                <tr key={grant.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{grant.student.user.name}</td>
                  <td className="px-4 py-2">{grant.lesson?.title ?? "—"}</td>
                  <td className="px-4 py-2">
                    {new Date(grant.grantedAt).toLocaleDateString("ar-EG")}
                  </td>
                  <td className="px-4 py-2">
                    {grant.expiresAt
                      ? new Date(grant.expiresAt).toLocaleDateString("ar-EG")
                      : "دائم"}
                  </td>
                </tr>
              ))}
              {recentGrants.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    لا توجد عمليات منح استثنائي بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
