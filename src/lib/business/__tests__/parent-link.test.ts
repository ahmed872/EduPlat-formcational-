import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createParent, createStudent } from "@/test/factories";
import { assertParentCanAccessStudent } from "@/lib/business/parent-access";
import {
  approveParentLink,
  getPendingLinkRequestsForStudent,
  rejectParentLink,
  requestParentLink,
} from "@/lib/business/parent-link";

beforeEach(async () => {
  await resetDatabase();
});

async function parentUserOf(parent: { userId: string }) {
  return prisma.user.findUniqueOrThrow({ where: { id: parent.userId } });
}
async function studentUserOf(student: { userId: string }) {
  return prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
}

describe("requestParentLink", () => {
  it("creates an unapproved link by the student's email", async () => {
    const parent = await createParent();
    const student = await createStudent();
    const parentUser = await parentUserOf(parent);
    const studentUser = await studentUserOf(student);

    const link = await requestParentLink(prisma, {
      parentUserId: parentUser.id,
      studentEmail: studentUser.email,
    });

    expect(link.approvedAt).toBeNull();
    expect(link.studentId).toBe(student.id);
    expect(link.parentId).toBe(parent.id);
  });

  it("is case-insensitive on the student's email", async () => {
    const parent = await createParent();
    const student = await createStudent();
    const parentUser = await parentUserOf(parent);
    const studentUser = await studentUserOf(student);

    const link = await requestParentLink(prisma, {
      parentUserId: parentUser.id,
      studentEmail: studentUser.email.toUpperCase(),
    });

    expect(link.studentId).toBe(student.id);
  });

  it("rejects a request for an email with no student account", async () => {
    const parent = await createParent();
    const parentUser = await parentUserOf(parent);

    await expect(
      requestParentLink(prisma, {
        parentUserId: parentUser.id,
        studentEmail: "nobody@test.local",
      }),
    ).rejects.toThrow(/لا يوجد حساب طالب/);
  });

  it("rejects a duplicate request for a student already linked (approved or pending)", async () => {
    const parent = await createParent();
    const student = await createStudent();
    const parentUser = await parentUserOf(parent);
    const studentUser = await studentUserOf(student);

    await requestParentLink(prisma, { parentUserId: parentUser.id, studentEmail: studentUser.email });

    await expect(
      requestParentLink(prisma, { parentUserId: parentUser.id, studentEmail: studentUser.email }),
    ).rejects.toThrow(/طلب ربط/);
  });
});

describe("approveParentLink / rejectParentLink", () => {
  it("grants real access to the parent only after the student approves", async () => {
    const parent = await createParent();
    const student = await createStudent();
    const parentUser = await parentUserOf(parent);
    const studentUser = await studentUserOf(student);

    const link = await requestParentLink(prisma, {
      parentUserId: parentUser.id,
      studentEmail: studentUser.email,
    });

    await expect(
      assertParentCanAccessStudent(prisma, {
        parentUserId: parentUser.id,
        studentProfileId: student.id,
      }),
    ).rejects.toThrow(/not been approved/i);

    await approveParentLink(prisma, { parentStudentId: link.id, studentId: student.id });

    await expect(
      assertParentCanAccessStudent(prisma, {
        parentUserId: parentUser.id,
        studentProfileId: student.id,
      }),
    ).resolves.not.toThrow();
  });

  it("rejects approving a link that belongs to a different student", async () => {
    const parent = await createParent();
    const student = await createStudent();
    const otherStudent = await createStudent();
    const parentUser = await parentUserOf(parent);
    const studentUser = await studentUserOf(student);

    const link = await requestParentLink(prisma, {
      parentUserId: parentUser.id,
      studentEmail: studentUser.email,
    });

    await expect(
      approveParentLink(prisma, { parentStudentId: link.id, studentId: otherStudent.id }),
    ).rejects.toThrow(/لا يمكنك الموافقة/);
  });

  it("removes the request entirely on rejection", async () => {
    const parent = await createParent();
    const student = await createStudent();
    const parentUser = await parentUserOf(parent);
    const studentUser = await studentUserOf(student);

    const link = await requestParentLink(prisma, {
      parentUserId: parentUser.id,
      studentEmail: studentUser.email,
    });
    await rejectParentLink(prisma, { parentStudentId: link.id, studentId: student.id });

    const remaining = await prisma.parentStudent.findUnique({ where: { id: link.id } });
    expect(remaining).toBeNull();
  });
});

describe("getPendingLinkRequestsForStudent", () => {
  it("lists only unapproved requests for that student", async () => {
    const student = await createStudent();
    const pendingParent = await createParent();
    const approvedParent = await createParent();

    await prisma.parentStudent.create({
      data: { parentId: pendingParent.id, studentId: student.id },
    });
    await prisma.parentStudent.create({
      data: { parentId: approvedParent.id, studentId: student.id, approvedAt: new Date() },
    });

    const pending = await getPendingLinkRequestsForStudent(prisma, student.id);

    expect(pending).toHaveLength(1);
    expect(pending[0].parentId).toBe(pendingParent.id);
  });
});
