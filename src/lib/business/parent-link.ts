import type { PrismaClient } from "@prisma/client";

/**
 * Self-service parent -> student linking. A parent submits a request by
 * the student's account email; the student must explicitly approve it
 * before the parent gets any access (see assertParentCanAccessStudent,
 * which checks approvedAt). Nothing here grants access on its own.
 */
export async function requestParentLink(
  prisma: PrismaClient,
  params: { parentUserId: string; studentEmail: string },
) {
  const parentProfile = await prisma.parentProfile.findUnique({
    where: { userId: params.parentUserId },
  });
  if (!parentProfile) {
    throw new Error("لا يوجد حساب ولي أمر مرتبط بهذا المستخدم");
  }

  const studentUser = await prisma.user.findUnique({
    where: { email: params.studentEmail.trim().toLowerCase() },
    include: { studentProfile: true },
  });
  if (!studentUser?.studentProfile) {
    throw new Error("لا يوجد حساب طالب مسجّل بهذا البريد الإلكتروني");
  }

  const existing = await prisma.parentStudent.findUnique({
    where: {
      parentId_studentId: {
        parentId: parentProfile.id,
        studentId: studentUser.studentProfile.id,
      },
    },
  });
  if (existing) {
    throw new Error(
      existing.approvedAt
        ? "أنت مرتبط بهذا الطالب بالفعل"
        : "يوجد طلب ربط بانتظار موافقة الطالب بالفعل",
    );
  }

  return prisma.parentStudent.create({
    data: {
      parentId: parentProfile.id,
      studentId: studentUser.studentProfile.id,
    },
  });
}

export async function getPendingLinkRequestsForStudent(
  prisma: PrismaClient,
  studentId: string,
) {
  return prisma.parentStudent.findMany({
    where: { studentId, approvedAt: null },
    include: { parent: { include: { user: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function approveParentLink(
  prisma: PrismaClient,
  params: { parentStudentId: string; studentId: string },
) {
  const link = await prisma.parentStudent.findUniqueOrThrow({
    where: { id: params.parentStudentId },
  });
  if (link.studentId !== params.studentId) {
    throw new Error("لا يمكنك الموافقة على طلب ربط لطالب آخر");
  }
  return prisma.parentStudent.update({
    where: { id: params.parentStudentId },
    data: { approvedAt: new Date() },
  });
}

export async function rejectParentLink(
  prisma: PrismaClient,
  params: { parentStudentId: string; studentId: string },
) {
  const link = await prisma.parentStudent.findUniqueOrThrow({
    where: { id: params.parentStudentId },
  });
  if (link.studentId !== params.studentId) {
    throw new Error("لا يمكنك رفض طلب ربط لطالب آخر");
  }
  return prisma.parentStudent.delete({ where: { id: params.parentStudentId } });
}
