import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requestLink } from "./actions";

export default async function ParentDashboardPage() {
  const session = await auth();
  const parentProfile = await prisma.parentProfile.findUnique({
    where: { userId: session!.user.id },
    include: {
      children: {
        include: {
          student: {
            include: {
              user: true,
              dailyStudyStats: true,
              streak: true,
            },
          },
        },
      },
    },
  });

  const links = parentProfile?.children ?? [];
  const approvedChildren = links.filter((link) => link.approvedAt !== null);
  const pendingRequests = links.filter((link) => link.approvedAt === null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-bold">أبنائي</h1>

      <form
        action={requestLink}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">
            البريد الإلكتروني لحساب الطالب
          </span>
          <input
            type="email"
            name="studentEmail"
            required
            className="min-w-64 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إرسال طلب ربط
        </button>
      </form>
      <p className="-mt-4 text-xs text-gray-500">
        سيصل الطلب إلى الطالب ولن تتمكن من رؤية بياناته إلا بعد موافقته.
      </p>

      {pendingRequests.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-600">
            طلبات بانتظار الموافقة
          </h2>
          <ul className="flex flex-col gap-2">
            {pendingRequests.map(({ id, student }) => (
              <li
                key={id}
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                {student.user.name} — بانتظار موافقة الطالب
              </li>
            ))}
          </ul>
        </div>
      )}

      {approvedChildren.length === 0 && pendingRequests.length === 0 && (
        <p className="text-sm text-gray-500">
          لا يوجد أبناء مرتبطين بحسابك بعد. أرسل طلب ربط ببريد حساب ابنك/ابنتك.
        </p>
      )}

      {approvedChildren.map(({ student }) => {
        const totalSeconds = student.dailyStudyStats.reduce(
          (sum, s) => sum + s.totalActiveSeconds,
          0,
        );
        return (
          <div key={student.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{student.user.name}</h2>
              <Link
                href={`/parent/students/${student.id}/analytics`}
                className="text-sm text-indigo-600 hover:underline"
              >
                عرض التقدم التفصيلي
              </Link>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-4 text-sm text-gray-600 md:grid-cols-3">
              <p>إجمالي وقت المذاكرة: {Math.round(totalSeconds / 60)} دقيقة</p>
              <p>السلسلة الحالية: {student.streak?.currentStreak ?? 0} يوم</p>
              <p>أطول سلسلة: {student.streak?.longestStreak ?? 0} يوم</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
