import { prisma } from "@/lib/prisma";
import { confirmPaymentAction, refundPaymentAction, rejectPaymentAction } from "./actions";

export default async function PaymentsQueuePage() {
  const payments = await prisma.payment.findMany({
    where: { status: "PENDING" },
    include: { subscription: { include: { student: { include: { user: true } }, plan: true } } },
    orderBy: { createdAt: "asc" },
  });

  const recentDecided = await prisma.payment.findMany({
    where: { status: { in: ["SUCCEEDED", "FAILED", "REFUNDED"] } },
    include: { subscription: { include: { student: { include: { user: true } }, plan: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">مدفوعات في انتظار التأكيد</h1>
        <p className="mt-1 text-sm text-gray-600">
          لا يوجد مزود دفع إلكتروني مفعّل حاليًا (راجع SECURITY.md). كل
          اشتراك بمبلغ أكبر من صفر ينتظر تأكيدك اليدوي بعد استلام التحويل
          الفعلي.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {payments.map((payment) => (
          <div
            key={payment.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
          >
            <div>
              <p className="font-semibold">{payment.subscription.student.user.name}</p>
              <p className="text-sm text-gray-600">
                {payment.subscription.plan.name} · {(payment.amountCents / 100).toFixed(2)}{" "}
                {payment.currency}
                {payment.amountCents !== payment.originalAmountCents &&
                  ` (بعد الخصم من ${(payment.originalAmountCents / 100).toFixed(2)})`}
              </p>
              <p className="text-xs text-gray-500">
                {new Date(payment.createdAt).toLocaleString("ar-EG")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <form action={confirmPaymentAction.bind(null, payment.id)}>
                <button
                  type="submit"
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
                >
                  تأكيد استلام المبلغ
                </button>
              </form>
              <form
                action={rejectPaymentAction.bind(null, payment.id)}
                className="flex items-center gap-2"
              >
                <input
                  name="reason"
                  placeholder="سبب الرفض (اختياري)"
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                >
                  رفض
                </button>
              </form>
            </div>
          </div>
        ))}
        {payments.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد مدفوعات معلّقة حاليًا.</p>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">آخر القرارات</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-right text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">الطالب</th>
                <th className="px-4 py-2">الخطة</th>
                <th className="px-4 py-2">المبلغ</th>
                <th className="px-4 py-2">الحالة</th>
                <th className="px-4 py-2">التاريخ</th>
                <th className="px-4 py-2">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {recentDecided.map((payment) => (
                <tr key={payment.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{payment.subscription.student.user.name}</td>
                  <td className="px-4 py-2">{payment.subscription.plan.name}</td>
                  <td className="px-4 py-2">
                    {(payment.amountCents / 100).toFixed(2)} {payment.currency}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        payment.status === "SUCCEEDED"
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                          : payment.status === "REFUNDED"
                            ? "rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700"
                            : "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
                      }
                    >
                      {payment.status === "SUCCEEDED"
                        ? "مؤكد"
                        : payment.status === "REFUNDED"
                          ? "مسترجع"
                          : "مرفوض"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {new Date(payment.createdAt).toLocaleDateString("ar-EG")}
                  </td>
                  <td className="px-4 py-2">
                    {payment.status === "SUCCEEDED" && (
                      <form
                        action={refundPaymentAction.bind(null, payment.id)}
                        className="flex items-center gap-2"
                      >
                        <input
                          name="reason"
                          placeholder="سبب الاسترجاع"
                          required
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          استرجاع
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {recentDecided.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    لا يوجد سجل بعد.
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
