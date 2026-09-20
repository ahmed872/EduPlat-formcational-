"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { createSupportTicket, replyToTicket } from "@/lib/business/support";
import { assertParentCanAccessStudent } from "@/lib/business/parent-access";
import type { SupportCategory } from "@prisma/client";

export async function createTicket(formData: FormData) {
  const session = await auth();
  requireRole(session, ["PARENT"]);

  const category = String(formData.get("category") ?? "") as SupportCategory;
  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "") || null;
  if (!subject || !description) {
    throw new Error("الرجاء إدخال موضوع ووصف المشكلة");
  }

  // Reuses the same canonical link-check every other parent-facing read
  // goes through, instead of re-implementing the approvedAt condition
  // inline (which would silently drift if that check ever gained logic).
  if (studentId) {
    await assertParentCanAccessStudent(prisma, {
      parentUserId: session.user.id,
      studentProfileId: studentId,
    });
  }

  const ticket = await createSupportTicket(prisma, {
    authorId: session.user.id,
    studentId,
    category,
    subject,
    description,
  });

  redirect(`/parent/support/${ticket.id}`);
}

export async function addReply(ticketId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["PARENT"]);

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("الرجاء كتابة رد");

  await replyToTicket(prisma, {
    ticketId,
    authorId: session.user.id,
    authorRole: session.user.role,
    body,
  });

  revalidatePath(`/parent/support/${ticketId}`);
}
