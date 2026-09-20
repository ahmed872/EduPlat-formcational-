import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPendingLinkRequestsForStudent } from "@/lib/business/parent-link";
import { approveRequest, rejectRequest, revokeLink } from "./actions";

export default async function ParentRequestsPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const [pending, approvedLinks] = await Promise.all([
    getPendingLinkRequestsForStudent(prisma, studentId),
    prisma.parentStudent.findMany({
      where: { studentId, approvedAt: { not: null } },
      include: { parent: { include: { user: true } } },
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">طلبات ربط أولياء الأمور</h1>
        <p className="mt-1 text-sm text-gray-600">
          يمكن لولي الأمر رؤية تقدمك الدراسي فقط بعد موافقتك على طلبه هنا —
          لا أحد يحصل على هذه الصلاحية تلقائيًا.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {pending.map((request) => (
          <div
            key={request.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4"
          >
            <div>
              <p className="font-medium">{request.parent.user.name}</p>
              <p className="text-xs text-gray-500">{request.parent.user.email}</p>
            </div>
            <div className="flex gap-2">
              <form action={approveRequest.bind(null, request.id)}>
                <button
                  type="submit"
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
                >
                  موافقة
                </button>
              </form>
              <form action={rejectRequest.bind(null, request.id)}>
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  رفض
                </button>
              </form>
            </div>
          </div>
        ))}
        {pending.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد طلبات ربط جديدة.</p>
        )}
      </div>

      {approvedLinks.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-600">
            أولياء الأمور المرتبطون بحسابك
          </h2>
          <ul className="flex flex-col gap-2">
            {approvedLinks.map((link) => (
              <li
                key={link.id}
                className="flex items-center justify-between rounded-md border border-gray-100 bg-white px-3 py-2 text-sm"
              >
                <span>{link.parent.user.name}</span>
                <form action={revokeLink.bind(null, link.id)}>
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:underline"
                  >
                    إلغاء الربط
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
