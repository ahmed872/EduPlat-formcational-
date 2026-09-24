import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getReportForViewer } from "@/lib/business/reports";
import { ForbiddenError } from "@/lib/rbac";
import { ReportDocument } from "@/components/report-document";
import { PrintButton } from "@/components/print-button";

type Params = { params: Promise<{ studentId: string; reportId: string }> };

async function load({ params }: Params) {
  const { studentId, reportId } = await params;
  const session = await auth();
  if (!session?.user) notFound();
  try {
    return await getReportForViewer(prisma, {
      reportId,
      studentId,
      viewer: { userId: session.user.id, role: session.user.role },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const report = await load(props);
  // Becomes the suggested file name in the browser's "Save as PDF".
  return { title: `تقرير ${report.student.user.name} ${report.periodStart.toISOString().slice(0, 10)}` };
}

/** Report preview + Print / Save as PDF, for a linked, approved parent. */
export default async function ParentReportPage(props: Params) {
  const report = await load(props);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/parent/students/${report.studentId}/reports`} className="text-xs text-indigo-600 hover:underline">
          ← كل التقارير
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">اختر «حفظ كـ PDF» في نافذة الطباعة لتنزيل التقرير</span>
          <PrintButton label="تنزيل PDF / طباعة" />
        </div>
      </div>
      <ReportDocument report={report} />
    </div>
  );
}
