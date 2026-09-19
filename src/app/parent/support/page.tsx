import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTicketsForAuthor } from "@/lib/business/support";
import { createTicket } from "./actions";

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
  WAITING: "بانتظار ردك",
  RESOLVED: "تم الحل",
  CLOSED: "مغلقة",
};

export default async function ParentSupportPage() {
  const session = await auth();
  const [tickets, parentProfile] = await Promise.all([
    getTicketsForAuthor(prisma, session!.user.id),
    prisma.parentProfile.findUnique({
      where: { userId: session!.user.id },
      include: { children: { include: { student: { include: { user: true } } } } },
    }),
  ]);
  const approvedChildren = (parentProfile?.children ?? []).filter((c) => c.approvedAt !== null);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الدعم الفني</h1>
        <p className="mt-1 text-sm text-gray-600">افتح تذكرة ليردّ عليك المعلم أو الإدارة.</p>
      </div>

      <form action={createTicket} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold">تذكرة جديدة</h2>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">بخصوص (اختياري)</span>
          <select name="studentId" className="rounded-md border border-gray-300 px-3 py-2">
            <option value="">حسابي أنا</option>
            {approvedChildren.map((child) => (
              <option key={child.studentId} value={child.studentId}>
                {child.student.user.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">النوع</span>
          <select name="category" required className="rounded-md border border-gray-300 px-3 py-2">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الموضوع</span>
          <input name="subject" required className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">وصف المشكلة</span>
          <textarea name="description" required rows={3} className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <button type="submit" className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
          إرسال
        </button>
      </form>

      <div>
        <h2 className="mb-2 text-lg font-bold">تذاكري</h2>
        <div className="flex flex-col gap-2">
          {tickets.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/parent/support/${ticket.id}`}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 text-sm hover:border-indigo-300"
            >
              <div>
                <p className="font-medium">{ticket.subject}</p>
                <p className="text-xs text-gray-500">{CATEGORY_LABELS[ticket.category]}</p>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {STATUS_LABELS[ticket.status]}
              </span>
            </Link>
          ))}
          {tickets.length === 0 && <p className="text-sm text-gray-500">لا توجد تذاكر بعد.</p>}
        </div>
      </div>
    </div>
  );
}
