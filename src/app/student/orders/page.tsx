import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOrdersForStudent } from "@/lib/business/store";
import { cancelOrder } from "../store/actions";
import type { OrderStatus } from "@prisma/client";

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "بانتظار تأكيد الدفع",
  CONFIRMED: "تم تأكيد الدفع",
  PREPARING: "جارٍ التجهيز",
  SHIPPED: "تم الشحن",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغي",
};

export default async function StudentOrdersPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;
  const orders = await getOrdersForStudent(prisma, studentId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold">طلباتي</h1>

      <div className="flex flex-col gap-3">
        {orders.map((order) => (
          <div key={order.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">{order.createdAt.toLocaleDateString("ar-EG")}</p>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {STATUS_LABELS[order.status]}
              </span>
            </div>
            <ul className="mt-2 text-sm">
              {order.items.map((item) => (
                <li key={item.id}>
                  {item.product.title} × {item.quantity}
                </li>
              ))}
            </ul>
            <p className="mt-2 font-semibold">{(order.totalCents / 100).toFixed(2)} جنيه</p>
            {order.status === "PENDING" && (
              <form action={cancelOrder.bind(null, order.id)} className="mt-2">
                <button type="submit" className="text-xs text-red-600 hover:underline">
                  إلغاء الطلب
                </button>
              </form>
            )}
          </div>
        ))}
        {orders.length === 0 && <p className="text-sm text-gray-500">لا توجد طلبات بعد.</p>}
      </div>
    </div>
  );
}
