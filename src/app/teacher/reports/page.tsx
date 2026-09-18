import { prisma } from "@/lib/prisma";
import { createReport, addComment } from "./actions";
import type { ReportData } from "@/lib/business/reports";

function formatHours(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}س ${minutes}د` : `${minutes}د`;
}

export default async function TeacherReportsPage() {
  const [students, reports] = await Promise.all([
    prisma.studentProfile.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.parentReport.findMany({
      include: { student: { include: { user: true } } },
      orderBy: { generatedAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">تقارير الطلاب</h1>
        <p className="mt-1 text-sm text-gray-600">
          تقرير لفترة محددة (مثلًا شهر) يُحفظ كسجل دائم لولي الأمر — على عكس
          صفحة التحليلات الحية التي تعرض الحالة الآن فقط.
        </p>
      </div>

      <form
        action={createReport}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الطالب</span>
          <select
            name="studentId"
            required
            className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">اختر طالبًا</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.user.name} ({student.user.email})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">بداية الفترة</span>
          <input
            type="date"
            name="periodStart"
            required
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">نهاية الفترة</span>
          <input
            type="date"
            name="periodEnd"
            required
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إنشاء تقرير
        </button>
      </form>

      <div className="flex flex-col gap-3">
        {reports.map((report) => {
          const data = report.dataJson as ReportData;
          return (
            <div key={report.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{report.student.user.name}</p>
                <p className="text-xs text-gray-500">
                  {report.periodStart.toLocaleDateString("ar-EG")} —{" "}
                  {report.periodEnd.toLocaleDateString("ar-EG")}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm text-gray-600 md:grid-cols-4">
                <p>وقت المذاكرة: {formatHours(data.totalStudySeconds)}</p>
                <p>دروس مكتملة: {data.lessonsCompleted}</p>
                <p>
                  اختبارات ناجحة: {data.quizzesPassed} / {data.quizzesTaken}
                </p>
                <p>تجارب مكتملة: {data.experimentsCompleted}</p>
              </div>
              {report.teacherComments ? (
                <p className="mt-3 rounded-md bg-gray-50 p-2 text-sm text-gray-700">
                  ملاحظة المعلم: {report.teacherComments}
                </p>
              ) : (
                <form
                  action={addComment.bind(null, report.id)}
                  className="mt-3 flex items-end gap-2"
                >
                  <input
                    name="comment"
                    placeholder="أضف ملاحظة لولي الأمر (اختياري)"
                    className="min-w-64 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-gray-200 px-3 py-1.5 text-xs hover:bg-gray-300"
                  >
                    حفظ
                  </button>
                </form>
              )}
            </div>
          );
        })}
        {reports.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد تقارير بعد.</p>
        )}
      </div>
    </div>
  );
}
