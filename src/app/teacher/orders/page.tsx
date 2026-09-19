import { prisma } from "@/lib/prisma";
import { getAllOrders } from "@/lib/business/store";
import { advanceOrder } from "./actions";
import type { OrderStatus } from "@prisma/client";

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "بانتظار تأكيد الدفع",
  CONFIRMED: "تم تأكيد الدفع",
  PREPARING: "جارٍ التجهيز",
  SHIPPED: "تم الشحن",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغي",
};

const NEXT_ACTIONS: Partial<Record<OrderStatus, { status: OrderStatus; label: string }[]>> = {
  PENDING: [
    { status: "CONFIRMED", label: "تأكيد استلام الدفع" },
    { status: "CANCELLED", label: "إلغاء" },
  ],
  CONFIRMED: [
    { status: "PREPARING", label: "بدء التجهيز" },
    { status: "CANCELLED", label: "إلغاء" },
  ],
  PREPARING: [
    { status: "SHIPPED", label: "تم الشحن" },
    { status: "CANCELLED", label: "إلغاء" },
  ],
  SHIPPED: [{ status: "DELIVERED", label: "تم التسليم" }],
};

export default async function TeacherOrdersPage() {
  const orders = await getAllOrders(prisma);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">طلبات المتجر</h1>
        <p className="mt-1 text-sm text-gray-600">
          &quot;تأكيد استلام الدفع&quot; يعني أنك تحققت فعليًا من استلام المبلغ (نقدًا أو تحويلًا) — لا يوجد تأكيد آلي لطلب غير مجاني.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {orders.map((order) => (
          <div key={order.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{order.student.user.name}</p>
                <p className="text-xs text-gray-500">
                  {order.items.map((item) => `${item.product.title} × ${item.quantity}`).join("، ")}
                </p>
              </div>
              <div className="text-left">
                <p className="font-semibold">{(order.totalCents / 100).toFixed(2)} جنيه</p>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  {STATUS_LABELS[order.status]}
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(NEXT_ACTIONS[order.status] ?? []).map((action) => (
                <form key={action.status} action={advanceOrder.bind(null, order.id, action.status)}>
                  <button
                    type="submit"
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700"
                  >
                    {action.label}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ))}
        {orders.length === 0 && <p className="text-sm text-gray-500">لا توجد طلبات بعد.</p>}
      </div>
    </div>
  );
}
