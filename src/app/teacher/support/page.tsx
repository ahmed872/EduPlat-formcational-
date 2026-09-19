import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAllTickets } from "@/lib/business/support";
import type { SupportStatus } from "@prisma/client";

const CATEGORY_LABELS: Record<string, string> = {
  TECHNICAL: "مشكلة تقنية",
  PAYMENT: "الدفع",
  VIDEO_PROBLEM: "مشكلة في الفيديو",
  ACCOUNT: "الحساب",
  COURSE_QUESTION: "استفسار عن كورس",
  OTHER: "أخرى",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "مفتوحة",
  IN_PROGRESS: "قيد المعالجة",
  WAITING: "بانتظار الطالب",
  RESOLVED: "تم الحل",
  CLOSED: "مغلقة",
};

export default async function TeacherSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const tickets = await getAllTickets(prisma, {
    status: status ? (status as SupportStatus) : undefined,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">تذاكر الدعم الفني</h1>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/teacher/support"
          className={`rounded-full px-3 py-1 text-xs ${!status ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"}`}
        >
          الكل
        </Link>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <Link
            key={value}
            href={`/teacher/support?status=${value}`}
            className={`rounded-full px-3 py-1 text-xs ${
              status === value ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {tickets.map((ticket) => (
          <Link
            key={ticket.id}
            href={`/teacher/support/${ticket.id}`}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300"
          >
            <div>
              <p className="font-medium">{ticket.subject}</p>
              <p className="text-xs text-gray-500">
                {ticket.author.name}
                {ticket.student ? ` — بخصوص: ${ticket.student.user.name}` : ""} ·{" "}
                {CATEGORY_LABELS[ticket.category]}
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {STATUS_LABELS[ticket.status]}
            </span>
          </Link>
        ))}
        {tickets.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد تذاكر لهذه الحالة.</p>
        )}
      </div>
    </div>
  );
}
