import type { PrismaClient, SupportCategory, SupportStatus } from "@prisma/client";
import { ForbiddenError } from "@/lib/rbac";

export async function createSupportTicket(
  prisma: PrismaClient,
  params: {
    authorId: string;
    studentId?: string | null;
    category: SupportCategory;
    subject: string;
    description: string;
  },
) {
  return prisma.supportTicket.create({
    data: {
      authorId: params.authorId,
      studentId: params.studentId ?? null,
      category: params.category,
      subject: params.subject,
      description: params.description,
    },
  });
}

export function assertCanViewTicket(
  ticket: { authorId: string },
  viewer: { id: string; role: string },
) {
  if (viewer.role === "TEACHER_ADMIN") return;
  if (ticket.authorId !== viewer.id) {
    throw new ForbiddenError("لا يمكنك عرض هذه التذكرة");
  }
}

/**
 * Either the ticket's original author or any teacher/admin (acting as
 * support staff) may reply. A staff reply on a still-OPEN ticket moves it
 * to IN_PROGRESS automatically — real state that reflects someone is now
 * handling it, not a status the teacher has to remember to set by hand.
 */
export async function replyToTicket(
  prisma: PrismaClient,
  params: { ticketId: string; authorId: string; authorRole: string; body: string },
) {
  const ticket = await prisma.supportTicket.findUniqueOrThrow({
    where: { id: params.ticketId },
  });
  const isStaff = params.authorRole === "TEACHER_ADMIN";
  if (!isStaff && ticket.authorId !== params.authorId) {
    throw new ForbiddenError("لا يمكنك الرد على تذكرة دعم لا تخصك");
  }

  const reply = await prisma.supportTicketReply.create({
    data: { ticketId: params.ticketId, authorId: params.authorId, body: params.body },
  });

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: isStaff && ticket.status === "OPEN" ? { status: "IN_PROGRESS" } : {},
  });

  return reply;
}

export async function updateTicketStatus(
  prisma: PrismaClient,
  params: { ticketId: string; status: SupportStatus },
) {
  return prisma.supportTicket.update({
    where: { id: params.ticketId },
    data: { status: params.status },
  });
}

export async function getTicketWithThread(prisma: PrismaClient, ticketId: string) {
  return prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      author: true,
      student: { include: { user: true } },
      replies: { include: { author: true }, orderBy: { createdAt: "asc" } },
    },
  });
}

export async function getTicketsForAuthor(prisma: PrismaClient, authorId: string) {
  return prisma.supportTicket.findMany({
    where: { authorId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getAllTickets(
  prisma: PrismaClient,
  params: { status?: SupportStatus } = {},
) {
  return prisma.supportTicket.findMany({
    where: params.status ? { status: params.status } : undefined,
    include: { author: true, student: { include: { user: true } } },
    orderBy: { updatedAt: "desc" },
  });
}
