import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/rbac";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ bookmarkId: string }> },
) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { bookmarkId } = await context.params;

    const bookmark = await prisma.bookmark.findUnique({ where: { id: bookmarkId } });
    if (!bookmark || bookmark.studentId !== session.user.studentProfileId) {
      throw new ForbiddenError("This bookmark does not belong to you");
    }

    await prisma.bookmark.delete({ where: { id: bookmarkId } });
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
