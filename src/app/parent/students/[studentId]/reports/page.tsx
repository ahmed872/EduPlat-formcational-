import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertParentCanAccessStudent } from "@/lib/business/parent-access";
import { getReportsForStudent, type ReportData } from "@/lib/business/reports";
import { ForbiddenError } from "@/lib/rbac";

function formatHours(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}س ${minutes}د` : `${minutes}د`;
}

export default async function ParentStudentReportsPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const session = await auth();

  try {
    await assertParentCanAccessStudent(prisma, {
      parentUserId: session!.user.id,
      studentProfileId: studentId,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    include: { user: true },
  });
  if (!student) notFound();

  const reports = await getReportsForStudent(prisma, studentId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/parent" className="text-xs text-indigo-600 hover:underline">
          ← العودة إلى أبنائي
        </Link>
        <h1 className="mt-1 text-2xl font-bold">تقارير {student.user.name}</h1>
      </div>

      <div className="flex flex-col gap-3">
        {reports.map((report) => {
          const data = report.dataJson as ReportData;
          return (
            <div key={report.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {report.periodStart.toLocaleDateString("ar-EG")} —{" "}
                  {report.periodEnd.toLocaleDateString("ar-EG")}
                </p>
                <Link
                  href={`/parent/students/${studentId}/reports/${report.id}`}
                  data-report-link={report.id}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  معاينة / تنزيل PDF
                </Link>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm text-gray-600 md:grid-cols-4">
                <p>وقت المذاكرة: {formatHours(data.totalStudySeconds)}</p>
                <p>دروس مكتملة: {data.lessonsCompleted}</p>
                <p>
                  اختبارات ناجحة: {data.quizzesPassed} / {data.quizzesTaken}
                </p>
                <p>تجارب مكتملة: {data.experimentsCompleted}</p>
              </div>
              {report.teacherComments && (
                <p className="mt-3 rounded-md bg-gray-50 p-2 text-sm text-gray-700">
                  ملاحظة المعلم: {report.teacherComments}
                </p>
              )}
            </div>
          );
        })}
        {reports.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد تقارير منشورة لهذا الطالب بعد.</p>
        )}
      </div>
    </div>
  );
}
