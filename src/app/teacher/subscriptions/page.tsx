import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { syncExpiredSubscriptions } from "@/lib/business/subscription";
import { createPlan, togglePlanActive } from "./actions";

export default async function SubscriptionPlansPage() {
  await syncExpiredSubscriptions(prisma);

  const plans = await prisma.subscriptionPlan.findMany({
    include: {
      items: true,
      subscriptions: { where: { status: "ACTIVE" }, select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">خطط الاشتراك</h1>

      <form
        action={createPlan}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">اسم الخطة</span>
          <input
            name="name"
            required
            placeholder="خطة سبتمبر"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">السعر (جنيه)</span>
          <input
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">العام الدراسي</span>
          <input
            name="academicYear"
            required
            placeholder="2026"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إنشاء خطة
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{plan.name}</p>
                <p className="text-sm text-gray-500">
                  {(plan.priceCents / 100).toFixed(2)} {plan.currency} · {plan.academicYear}
                </p>
              </div>
              <span
                className={
                  plan.active
                    ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                    : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                }
              >
                {plan.active ? "مفعّلة" : "متوقفة"}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {plan.items.length} كورس مشمول · {plan.subscriptions.length} مشترك حاليًا
            </p>
            <div className="mt-3 flex items-center justify-between">
              <Link
                href={`/teacher/subscriptions/${plan.id}`}
                className="text-sm text-indigo-600 hover:underline"
              >
                إدارة المحتوى
              </Link>
              <form action={togglePlanActive.bind(null, plan.id, !plan.active)}>
                <button type="submit" className="text-xs text-gray-500 hover:underline">
                  {plan.active ? "إيقاف" : "تفعيل"}
                </button>
              </form>
            </div>
          </div>
        ))}
        {plans.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد خطط اشتراك بعد.</p>
        )}
      </div>
    </div>
  );
}
