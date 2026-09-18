import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createParent, createStudent } from "@/test/factories";
import { assertParentCanAccessStudent } from "@/lib/business/parent-access";

beforeEach(async () => {
  await resetDatabase();
});

describe("parent-student access control", () => {
  it("allows a parent to access their connected, approved student", async () => {
    const parent = await createParent();
    const student = await createStudent();
    await prisma.parentStudent.create({
      data: { parentId: parent.id, studentId: student.id, approvedAt: new Date() },
    });

    const parentUser = await prisma.user.findUniqueOrThrow({
      where: { id: parent.userId },
    });

    await expect(
      assertParentCanAccessStudent(prisma, {
        parentUserId: parentUser.id,
        studentProfileId: student.id,
      }),
    ).resolves.not.toThrow();
  });

  it("blocks a parent whose link exists but has not been approved by the student yet", async () => {
    const parent = await createParent();
    const student = await createStudent();
    await prisma.parentStudent.create({
      data: { parentId: parent.id, studentId: student.id }, // approvedAt left null
    });

    const parentUser = await prisma.user.findUniqueOrThrow({
      where: { id: parent.userId },
    });

    await expect(
      assertParentCanAccessStudent(prisma, {
        parentUserId: parentUser.id,
        studentProfileId: student.id,
      }),
    ).rejects.toThrow(/not been approved/i);
  });

  it("blocks a parent from accessing an unrelated student", async () => {
    const parent = await createParent();
    const unrelatedStudent = await createStudent();
    const parentUser = await prisma.user.findUniqueOrThrow({
      where: { id: parent.userId },
    });

    await expect(
      assertParentCanAccessStudent(prisma, {
        parentUserId: parentUser.id,
        studentProfileId: unrelatedStudent.id,
      }),
    ).rejects.toThrow(/not linked/i);
  });
});
