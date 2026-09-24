import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "بانتظار التأكيد",
  SUCCEEDED: "تم الدفع",
  FAILED: "مرفوض",
  REFUNDED: "تم الاسترداد",
};

const PROVIDER_LABELS: Record<string, string> = {
  MANUAL_OFFLINE: "دفع يدوي خارج المنصة",
  FREE: "بدون رسوم",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  SUCCEEDED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  REFUNDED: "bg-gray-100 text-gray-600",
};

export default async function PaymentHistoryPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const payments = await prisma.payment.findMany({
    where: { subscription: { studentId } },
    include: { subscription: { include: { plan: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold">سجل المدفوعات</h1>
      {payments.some((p) => p.status === "PENDING") && (
        <p data-testid="pending-manual-payment" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          لديك دفعة بانتظار التأكيد. هذا دفع يدوي: حوّل المبلغ بالطريقة التي يحددها
          المعلم، وسيُفعَّل اشتراكك بعد أن تؤكد الإدارة استلامه. لم يتم تحصيل أي مبلغ
          إلكترونيًا.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">الخطة</th>
              <th className="px-4 py-2">المبلغ</th>
              <th className="px-4 py-2">طريقة الدفع</th>
              <th className="px-4 py-2">الحالة</th>
              <th className="px-4 py-2">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{payment.subscription.plan.name}</td>
                <td className="px-4 py-2">
                  {(payment.amountCents / 100).toFixed(2)} {payment.currency}
                </td>
                <td className="px-4 py-2 text-xs text-gray-600">
                  {payment.provider ? (PROVIDER_LABELS[payment.provider] ?? payment.provider) : "—"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[payment.status] ?? ""}`}
                  >
                    {STATUS_LABELS[payment.status] ?? payment.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {new Date(payment.createdAt).toLocaleDateString("ar-EG")}
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  لا يوجد مدفوعات بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
