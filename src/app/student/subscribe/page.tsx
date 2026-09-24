import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncExpiredSubscriptions } from "@/lib/business/subscription";
import { redeemFreeCode, subscribeToPlan } from "./actions";

export default async function SubscribePage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;
  await syncExpiredSubscriptions(prisma);

  const [plans, mySubscriptions] = await Promise.all([
    prisma.subscriptionPlan.findMany({
      where: { active: true },
      include: { items: { include: { course: true } } },
    }),
    prisma.subscription.findMany({
      where: { studentId },
      include: { plan: true },
      orderBy: { purchasedAt: "desc" },
    }),
  ]);

  const activePlanIds = new Set(
    mySubscriptions
      .filter((s) => s.status === "ACTIVE" || s.status === "PENDING_PAYMENT")
      .map((s) => s.planId),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">الاشتراك في خطة تعليمية</h1>
        <p className="mt-1 text-sm text-gray-600">
          الاشتراك يمنحك الوصول للدروس الموجودة داخل الكورسات المشمولة{" "}
          <strong>وقت الاشتراك</strong>. أي محتوى ينشر لاحقًا لا يُضاف
          تلقائيًا.
        </p>
        <p
          data-testid="manual-payment-notice"
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        >
          الدفع يدوي خارج المنصة: لا توجد بوابة دفع إلكترونية، ولن يُخصم أي مبلغ هنا.
          بعد الضغط على «اشترك الآن» حوّل المبلغ بالطريقة التي يحددها المعلم
          (تحويل بنكي / محفظة / نقدًا)، ويُفعَّل الاشتراك فقط بعد أن تؤكد
          الإدارة استلام المبلغ. تابع الحالة في «سجل المدفوعات».
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => (
          <div key={plan.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-semibold">{plan.name}</p>
            <p className="mt-1 text-lg font-bold text-indigo-600">
              {(plan.priceCents / 100).toFixed(2)} {plan.currency}
            </p>
            <ul className="mt-2 text-xs text-gray-500">
              {plan.items.map((item) => (
                <li key={item.id}>{item.course?.title}</li>
              ))}
            </ul>
            {activePlanIds.has(plan.id) ? (
              <p className="mt-3 rounded-md bg-gray-100 px-3 py-2 text-center text-sm text-gray-600">
                لديك اشتراك في هذه الخطة بالفعل
              </p>
            ) : (
              <form action={subscribeToPlan} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="planId" value={plan.id} />
                <input
                  name="promoCode"
                  placeholder="كود خصم (اختياري)"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                >
                  اشترك الآن
                </button>
              </form>
            )}
          </div>
        ))}
        {plans.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد خطط اشتراك متاحة حاليًا.</p>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4">
        <h2 className="mb-2 font-semibold">لديك كود محتوى مجاني؟</h2>
        <form action={redeemFreeCode} className="flex gap-2">
          <input
            name="freeCode"
            required
            placeholder="أدخل الكود"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
          >
            تفعيل
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">اشتراكاتي</h2>
        <div className="flex flex-col gap-2">
          {mySubscriptions.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between rounded-md border border-gray-100 bg-white px-4 py-2 text-sm"
            >
              <span>{sub.plan.name}</span>
              <StatusBadge status={sub.status} />
            </div>
          ))}
          {mySubscriptions.length === 0 && (
            <p className="text-sm text-gray-500">لا يوجد اشتراكات بعد.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    ACTIVE: "فعّال",
    PENDING_PAYMENT: "بانتظار تأكيد الدفع",
    EXPIRED: "منتهي",
    CANCELLED: "ملغي",
  };
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-700",
    PENDING_PAYMENT: "bg-amber-100 text-amber-700",
    EXPIRED: "bg-gray-100 text-gray-600",
    CANCELLED: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${colors[status] ?? ""}`}>
      {labels[status] ?? status}
    </span>
  );
}
