"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { createSupportTicket, replyToTicket } from "@/lib/business/support";
import type { SupportCategory } from "@prisma/client";

export async function createTicket(formData: FormData) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  const category = String(formData.get("category") ?? "") as SupportCategory;
  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!subject || !description) {
    throw new Error("الرجاء إدخال موضوع ووصف المشكلة");
  }

  const ticket = await createSupportTicket(prisma, {
    authorId: session.user.id,
    studentId: session.user.studentProfileId,
    category,
    subject,
    description,
  });

  redirect(`/student/support/${ticket.id}`);
}

export async function addReply(ticketId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("الرجاء كتابة رد");

  await replyToTicket(prisma, {
    ticketId,
    authorId: session.user.id,
    authorRole: session.user.role,
    body,
  });

  revalidatePath(`/student/support/${ticketId}`);
}
