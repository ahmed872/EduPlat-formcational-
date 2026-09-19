"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { replyToTicket, updateTicketStatus } from "@/lib/business/support";
import type { SupportStatus } from "@prisma/client";

export async function addReply(ticketId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("الرجاء كتابة رد");

  await replyToTicket(prisma, {
    ticketId,
    authorId: session.user.id,
    authorRole: session.user.role,
    body,
  });

  revalidatePath(`/teacher/support/${ticketId}`);
}

export async function setStatus(ticketId: string, status: SupportStatus) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await updateTicketStatus(prisma, { ticketId, status });

  revalidatePath(`/teacher/support/${ticketId}`);
  revalidatePath("/teacher/support");
}
