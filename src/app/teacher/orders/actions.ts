"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { updateOrderStatus } from "@/lib/business/store";
import type { OrderStatus } from "@prisma/client";

export async function advanceOrder(orderId: string, status: OrderStatus) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await updateOrderStatus(prisma, { orderId, status });

  revalidatePath("/teacher/orders");
}
