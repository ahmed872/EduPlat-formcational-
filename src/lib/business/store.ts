import type { OrderStatus, PrismaClient } from "@prisma/client";
import { ForbiddenError } from "@/lib/rbac";

export async function listActiveProducts(prisma: PrismaClient) {
  return prisma.product.findMany({
    where: { status: "PUBLISHED", stock: { gt: 0 } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Places a real order: validates real-time availability for every line
 * item and decrements stock immediately inside the same transaction
 * (preventing overselling between the page load and the submit), and
 * computes the total from each product's own current price — never a
 * client-supplied price. No payment is collected automatically; see
 * updateOrderStatus() for the manual confirmation gate.
 */
export async function placeOrder(
  prisma: PrismaClient,
  params: { studentId: string; items: Array<{ productId: string; quantity: number }> },
) {
  if (params.items.length === 0) {
    throw new Error("السلة فارغة");
  }

  return prisma.$transaction(async (tx) => {
    let totalCents = 0;
    const orderItemsData: Array<{ productId: string; quantity: number; priceCents: number }> = [];

    for (const item of params.items) {
      if (item.quantity <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر");

      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
      if (product.status !== "PUBLISHED") {
        throw new Error(`المنتج "${product.title}" غير متاح حاليًا`);
      }
      if (product.stock < item.quantity) {
        throw new Error(`الكمية المتوفرة من "${product.title}" غير كافية`);
      }

      await tx.product.update({
        where: { id: product.id },
        data: { stock: { decrement: item.quantity } },
      });

      totalCents += product.priceCents * item.quantity;
      orderItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        priceCents: product.priceCents,
      });
    }

    return tx.order.create({
      data: {
        studentId: params.studentId,
        totalCents,
        items: { create: orderItemsData },
      },
      include: { items: { include: { product: true } } },
    });
  });
}

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * Only a teacher/admin drives an order forward — CONFIRMED specifically
 * means real payment was manually verified (cash on pickup, bank
 * transfer, ...), the same "a human confirms real money was received"
 * gate the platform already uses for subscription payments; nothing here
 * fabricates a successful charge. Cancelling before shipping restocks
 * every line item.
 */
export async function updateOrderStatus(
  prisma: PrismaClient,
  params: { orderId: string; status: OrderStatus },
) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: params.orderId },
    include: { items: true },
  });

  const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(params.status)) {
    throw new Error(`لا يمكن تغيير حالة الطلب من ${order.status} إلى ${params.status}`);
  }

  if (params.status === "CANCELLED") {
    await prisma.$transaction([
      ...order.items.map((item) =>
        prisma.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        }),
      ),
      prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } }),
    ]);
  } else {
    await prisma.order.update({ where: { id: order.id }, data: { status: params.status } });
  }

  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

export async function cancelOwnPendingOrder(
  prisma: PrismaClient,
  params: { orderId: string; studentId: string },
) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: params.orderId } });
  if (order.studentId !== params.studentId) {
    throw new ForbiddenError("لا يمكنك إلغاء طلب لا يخصك");
  }
  // Once a teacher has confirmed payment or moved it further along, only
  // the teacher (via updateOrderStatus) may cancel it — a student
  // unilaterally cancelling a paid/in-progress order is a real business
  // rule, not just a UI omission.
  if (order.status !== "PENDING") {
    throw new Error("لا يمكن إلغاء طلب تم تأكيد دفعه بالفعل");
  }
  return updateOrderStatus(prisma, { orderId: params.orderId, status: "CANCELLED" });
}

export async function getOrdersForStudent(prisma: PrismaClient, studentId: string) {
  return prisma.order.findMany({
    where: { studentId },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAllOrders(prisma: PrismaClient) {
  return prisma.order.findMany({
    include: { items: { include: { product: true } }, student: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
  });
}
