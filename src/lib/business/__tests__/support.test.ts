import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import {
  assertCanViewTicket,
  createSupportTicket,
  getAllTickets,
  getTicketsForAuthor,
  replyToTicket,
  updateTicketStatus,
} from "@/lib/business/support";
import { ForbiddenError } from "@/lib/rbac";

beforeEach(async () => {
  await resetDatabase();
});

async function createTeacherUser() {
  return prisma.user.create({
    data: {
      email: `teacher-${Date.now()}-${Math.random()}@test.local`,
      name: "Test Teacher",
      passwordHash: "not-used-in-tests",
      role: "TEACHER_ADMIN",
    },
  });
}

async function studentUser(studentId: string) {
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } });
  return prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
}

describe("createSupportTicket", () => {
  it("creates a ticket that starts OPEN", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);

    const ticket = await createSupportTicket(prisma, {
      authorId: user.id,
      studentId: student.id,
      category: "TECHNICAL",
      subject: "مشكلة",
      description: "وصف المشكلة",
    });

    expect(ticket.status).toBe("OPEN");
  });
});

describe("assertCanViewTicket", () => {
  it("allows the ticket's own author", () => {
    expect(() =>
      assertCanViewTicket({ authorId: "u1" }, { id: "u1", role: "STUDENT" }),
    ).not.toThrow();
  });

  it("allows any teacher/admin", () => {
    expect(() =>
      assertCanViewTicket({ authorId: "u1" }, { id: "u2", role: "TEACHER_ADMIN" }),
    ).not.toThrow();
  });

  it("rejects an unrelated student/parent", () => {
    expect(() =>
      assertCanViewTicket({ authorId: "u1" }, { id: "u2", role: "STUDENT" }),
    ).toThrow(ForbiddenError);
  });
});

describe("replyToTicket", () => {
  it("allows the original author to reply", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);
    const ticket = await createSupportTicket(prisma, {
      authorId: user.id,
      category: "OTHER",
      subject: "س",
      description: "و",
    });

    const reply = await replyToTicket(prisma, {
      ticketId: ticket.id,
      authorId: user.id,
      authorRole: "STUDENT",
      body: "رد إضافي",
    });

    expect(reply.body).toBe("رد إضافي");
  });

  it("rejects a reply from an unrelated student", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);
    const otherStudent = await createStudent();
    const otherUser = await studentUser(otherStudent.id);
    const ticket = await createSupportTicket(prisma, {
      authorId: user.id,
      category: "OTHER",
      subject: "س",
      description: "و",
    });

    await expect(
      replyToTicket(prisma, {
        ticketId: ticket.id,
        authorId: otherUser.id,
        authorRole: "STUDENT",
        body: "محاولة تدخل",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("moves an OPEN ticket to IN_PROGRESS the moment staff replies", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);
    const teacher = await createTeacherUser();
    const ticket = await createSupportTicket(prisma, {
      authorId: user.id,
      category: "OTHER",
      subject: "س",
      description: "و",
    });

    await replyToTicket(prisma, {
      ticketId: ticket.id,
      authorId: teacher.id,
      authorRole: "TEACHER_ADMIN",
      body: "جاري النظر في الأمر",
    });

    const updated = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe("IN_PROGRESS");
  });

  it("does not override a status a teacher already advanced past OPEN", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);
    const teacher = await createTeacherUser();
    const ticket = await createSupportTicket(prisma, {
      authorId: user.id,
      category: "OTHER",
      subject: "س",
      description: "و",
    });
    await updateTicketStatus(prisma, { ticketId: ticket.id, status: "RESOLVED" });

    await replyToTicket(prisma, {
      ticketId: ticket.id,
      authorId: teacher.id,
      authorRole: "TEACHER_ADMIN",
      body: "متابعة",
    });

    const updated = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe("RESOLVED");
  });
});

describe("getTicketsForAuthor / getAllTickets", () => {
  it("getTicketsForAuthor only returns that author's own tickets", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);
    const otherStudent = await createStudent();
    const otherUser = await studentUser(otherStudent.id);
    await createSupportTicket(prisma, {
      authorId: user.id,
      category: "OTHER",
      subject: "تذكرتي",
      description: "و",
    });
    await createSupportTicket(prisma, {
      authorId: otherUser.id,
      category: "OTHER",
      subject: "تذكرة أخرى",
      description: "و",
    });

    const tickets = await getTicketsForAuthor(prisma, user.id);

    expect(tickets).toHaveLength(1);
    expect(tickets[0].subject).toBe("تذكرتي");
  });

  it("getAllTickets filters by status when given", async () => {
    const student = await createStudent();
    const user = await studentUser(student.id);
    const t1 = await createSupportTicket(prisma, {
      authorId: user.id,
      category: "OTHER",
      subject: "أ",
      description: "و",
    });
    await createSupportTicket(prisma, {
      authorId: user.id,
      category: "OTHER",
      subject: "ب",
      description: "و",
    });
    await updateTicketStatus(prisma, { ticketId: t1.id, status: "RESOLVED" });

    const resolved = await getAllTickets(prisma, { status: "RESOLVED" });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].subject).toBe("أ");
  });
});
