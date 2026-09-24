import type { ReportData } from "@/lib/business/reports";

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours} ساعة و${minutes} دقيقة` : `${minutes} دقيقة`;
}

/**
 * Tolerates older / partial snapshots: a missing number shows as 0 and a
 * missing average as "—", so a report never renders "NaN" or crashes.
 */
function normalize(raw: unknown): ReportData {
  const data = (raw ?? {}) as Partial<ReportData>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    totalStudySeconds: n(data.totalStudySeconds),
    lessonsCompleted: n(data.lessonsCompleted),
    quizzesTaken: n(data.quizzesTaken),
    quizzesPassed: n(data.quizzesPassed),
    averageQuizPercentage:
      typeof data.averageQuizPercentage === "number" && Number.isFinite(data.averageQuizPercentage)
        ? data.averageQuizPercentage
        : null,
    experimentsCompleted: n(data.experimentsCompleted),
  };
}

/** The printable report (also the on-screen preview). */
export function ReportDocument({
  report,
}: {
  report: {
    id: string;
    periodStart: Date;
    periodEnd: Date;
    generatedAt: Date;
    dataJson: unknown;
    teacherComments: string | null;
    student: { user: { name: string } };
  };
}) {
  const data = normalize(report.dataJson);
  const rows: [string, string][] = [
    ["إجمالي وقت المذاكرة الفعلي", formatDuration(data.totalStudySeconds)],
    ["الدروس المكتملة", String(data.lessonsCompleted)],
    ["الاختبارات التي تم تصحيحها", String(data.quizzesTaken)],
    ["الاختبارات الناجحة", `${data.quizzesPassed} من ${data.quizzesTaken}`],
    [
      "متوسط درجات الاختبارات",
      data.averageQuizPercentage === null ? "—" : `${data.averageQuizPercentage.toFixed(1)}٪`,
    ],
    ["التجارب التفاعلية المكتملة", String(data.experimentsCompleted)],
  ];

  return (
    <article
      dir="rtl"
      lang="ar"
      data-testid="report-document"
      className="flex flex-col gap-6 rounded-lg border border-gray-200 bg-white p-8 print:border-0 print:p-0"
    >
      <header className="flex items-start justify-between border-b border-gray-200 pb-4">
        <div>
          <p className="text-sm tracking-widest text-indigo-600">EduPlat</p>
          <h1 className="mt-1 text-2xl font-bold">تقرير أداء الطالب</h1>
          <p className="mt-1 text-lg" data-testid="report-student">
            {report.student.user.name}
          </p>
        </div>
        <div className="text-left text-sm text-gray-600">
          <p>
            الفترة: {report.periodStart.toLocaleDateString("ar-EG")} — {report.periodEnd.toLocaleDateString("ar-EG")}
          </p>
          <p className="mt-1">تاريخ الإنشاء: {report.generatedAt.toLocaleDateString("ar-EG")}</p>
        </div>
      </header>

      <table className="print-avoid-break w-full border-collapse text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-gray-100">
              <th scope="row" className="w-1/2 py-3 text-right font-medium text-gray-700">
                {label}
              </th>
              <td className="py-3 text-right font-semibold">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="print-avoid-break">
        <h2 className="mb-2 font-semibold">ملاحظة المعلم</h2>
        <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-700 print:bg-transparent print:p-0">
          {report.teacherComments || "لا توجد ملاحظات."}
        </p>
      </section>

      <footer className="border-t border-gray-200 pt-3 text-xs text-gray-400">
        تقرير لفترة محددة محفوظ كسجل دائم — رقم التقرير: <span dir="ltr">{report.id}</span>
      </footer>
    </article>
  );
}
