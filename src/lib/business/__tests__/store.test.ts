import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import {
  cancelOwnPendingOrder,
  getAllOrders,
  getOrdersForStudent,
  listActiveProducts,
  placeOrder,
  updateOrderStatus,
} from "@/lib/business/store";
import { ForbiddenError } from "@/lib/rbac";

beforeEach(async () => {
  await resetDatabase();
});

async function createProduct(overrides: {
  priceCents?: number;
  stock?: number;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
} = {}) {
  return prisma.product.create({
    data: {
      title: `منتج-${Date.now()}-${Math.random()}`,
      priceCents: overrides.priceCents ?? 1000,
      stock: overrides.stock ?? 10,
      status: overrides.status ?? "PUBLISHED",
    },
  });
}

describe("listActiveProducts", () => {
  it("only lists PUBLISHED products with stock left", async () => {
    const available = await createProduct();
    await createProduct({ status: "DRAFT" });
    await createProduct({ stock: 0 });

    const products = await listActiveProducts(prisma);

    expect(products.map((p) => p.id)).toEqual([available.id]);
  });
});

describe("placeOrder", () => {
  it("computes the total from the product's real price and decrements stock", async () => {
    const student = await createStudent();
    const product = await createProduct({ priceCents: 500, stock: 10 });

    const order = await placeOrder(prisma, {
      studentId: student.id,
      items: [{ productId: product.id, quantity: 3 }],
    });

    expect(order.totalCents).toBe(1500);
    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.stock).toBe(7);
  });

  it("cannot oversell the last unit under concurrent orders", async () => {
    // Regression test for a real race: a plain "read stock, compare, then
    // decrement" (even inside a $transaction) lets two concurrent orders
    // for the last unit both read stock=1, both pass, and both decrement —
    // driving stock negative. With stock=1 and 5 concurrent buyers, exactly
    // 1 order may succeed.
    const product = await createProduct({ stock: 1 });
    const students = await Promise.all(Array.from({ length: 5 }, () => createStudent()));

    const results = await Promise.allSettled(
      students.map((student) =>
        placeOrder(prisma, { studentId: student.id, items: [{ productId: product.id, quantity: 1 }] }),
      ),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded).toHaveLength(1);

    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.stock).toBe(0);
  });

  it("rejects an order exceeding real stock, without changing stock", async () => {
    const student = await createStudent();
    const product = await createProduct({ stock: 2 });

    await expect(
      placeOrder(prisma, { studentId: student.id, items: [{ productId: product.id, quantity: 5 }] }),
    ).rejects.toThrow(/غير كافية/);

    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.stock).toBe(2);
  });

  it("rejects ordering a product that isn't published", async () => {
    const student = await createStudent();
    const product = await createProduct({ status: "DRAFT" });

    await expect(
      placeOrder(prisma, { studentId: student.id, items: [{ productId: product.id, quantity: 1 }] }),
    ).rejects.toThrow(/غير متاح/);
  });

  it("rejects an empty cart", async () => {
    const student = await createStudent();
    await expect(placeOrder(prisma, { studentId: student.id, items: [] })).rejects.toThrow(/فارغة/);
  });

  it("rejects a zero or negative quantity", async () => {
    const student = await createStudent();
    const product = await createProduct();

    await expect(
      placeOrder(prisma, { studentId: student.id, items: [{ productId: product.id, quantity: 0 }] }),
    ).rejects.toThrow(/أكبر من صفر/);
  });

  it("never trusts a client-supplied price — only the real product price counts", async () => {
    const student = await createStudent();
    const product = await createProduct({ priceCents: 999 });

    const order = await placeOrder(prisma, {
      studentId: student.id,
      items: [{ productId: product.id, quantity: 1 }],
    });

    expect(order.totalCents).toBe(999);
  });
});

describe("updateOrderStatus", () => {
  it("allows PENDING -> CONFIRMED", async () => {
    const student = await createStudent();
    const product = await createProduct();
    const order = await placeOrder(prisma, {
      studentId: student.id,
      items: [{ productId: product.id, quantity: 1 }],
    });

    const updated = await updateOrderStatus(prisma, { orderId: order.id, status: "CONFIRMED" });
    expect(updated.status).toBe("CONFIRMED");
  });

  it("rejects an invalid transition (e.g. skipping straight to DELIVERED)", async () => {
    const student = await createStudent();
    const product = await createProduct();
    const order = await placeOrder(prisma, {
      studentId: student.id,
      items: [{ productId: product.id, quantity: 1 }],
    });

    await expect(
      updateOrderStatus(prisma, { orderId: order.id, status: "DELIVERED" }),
    ).rejects.toThrow(/لا يمكن تغيير/);
  });

  it("restocks every line item when an order is cancelled", async () => {
    const student = await createStudent();
    const product = await createProduct({ stock: 10 });
    const order = await placeOrder(prisma, {
      studentId: student.id,
      items: [{ productId: product.id, quantity: 4 }],
    });

    await updateOrderStatus(prisma, { orderId: order.id, status: "CANCELLED" });

    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.stock).toBe(10);
  });
});

describe("cancelOwnPendingOrder", () => {
  it("lets a student cancel their own still-pending order", async () => {
    const student = await createStudent();
    const product = await createProduct();
    const order = await placeOrder(prisma, {
      studentId: student.id,
      items: [{ productId: product.id, quantity: 1 }],
    });

    const cancelled = await cancelOwnPendingOrder(prisma, { orderId: order.id, studentId: student.id });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("rejects cancelling another student's order", async () => {
    const student = await createStudent();
    const otherStudent = await createStudent();
    const product = await createProduct();
    const order = await placeOrder(prisma, {
      studentId: student.id,
      items: [{ productId: product.id, quantity: 1 }],
    });

    await expect(
      cancelOwnPendingOrder(prisma, { orderId: order.id, studentId: otherStudent.id }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects cancelling an order the teacher already confirmed", async () => {
    const student = await createStudent();
    const product = await createProduct();
    const order = await placeOrder(prisma, {
      studentId: student.id,
      items: [{ productId: product.id, quantity: 1 }],
    });
    await updateOrderStatus(prisma, { orderId: order.id, status: "CONFIRMED" });

    await expect(
      cancelOwnPendingOrder(prisma, { orderId: order.id, studentId: student.id }),
    ).rejects.toThrow(/تأكيد دفعه/);
  });
});

describe("getOrdersForStudent / getAllOrders", () => {
  it("getOrdersForStudent only returns that student's own orders", async () => {
    const student = await createStudent();
    const otherStudent = await createStudent();
    const product = await createProduct();
    await placeOrder(prisma, { studentId: student.id, items: [{ productId: product.id, quantity: 1 }] });
    await placeOrder(prisma, { studentId: otherStudent.id, items: [{ productId: product.id, quantity: 1 }] });

    const orders = await getOrdersForStudent(prisma, student.id);
    expect(orders).toHaveLength(1);
    expect(orders[0].studentId).toBe(student.id);
  });

  it("getAllOrders returns every order across students", async () => {
    const student = await createStudent();
    const otherStudent = await createStudent();
    const product = await createProduct();
    await placeOrder(prisma, { studentId: student.id, items: [{ productId: product.id, quantity: 1 }] });
    await placeOrder(prisma, { studentId: otherStudent.id, items: [{ productId: product.id, quantity: 1 }] });

    const orders = await getAllOrders(prisma);
    expect(orders).toHaveLength(2);
  });
});
