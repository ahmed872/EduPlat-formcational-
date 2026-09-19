"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { placeOrder, cancelOwnPendingOrder } from "@/lib/business/store";

export async function checkout(items: Array<{ productId: string; quantity: number }>) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);
  const studentId = session.user.studentProfileId!;

  await placeOrder(prisma, { studentId, items });

  revalidatePath("/student/store");
  revalidatePath("/student/orders");
}

export async function cancelOrder(orderId: string) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);
  const studentId = session.user.studentProfileId!;

  await cancelOwnPendingOrder(prisma, { orderId, studentId });

  revalidatePath("/student/orders");
  revalidatePath("/student/store");
}
