import type { PrismaClient } from "@prisma/client";
import { ForbiddenError } from "@/lib/rbac";

/**
 * Parents never get implicit access to a student's data. Every read must
 * pass through this explicit link check, and it never grants access to
 * paid course content — only to the progress/report data a parent may see.
 */
export async function assertParentCanAccessStudent(
  prisma: PrismaClient,
  params: { parentUserId: string; studentProfileId: string },
): Promise<void> {
  const parentProfile = await prisma.parentProfile.findUnique({
    where: { userId: params.parentUserId },
  });
  if (!parentProfile) {
    throw new ForbiddenError("This user has no parent profile");
  }

  const link = await prisma.parentStudent.findUnique({
    where: {
      parentId_studentId: {
        parentId: parentProfile.id,
        studentId: params.studentProfileId,
      },
    },
  });

  if (!link) {
    throw new ForbiddenError("This parent is not linked to the given student");
  }
}
