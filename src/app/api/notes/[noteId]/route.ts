import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/rbac";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ noteId: string }> },
) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const { noteId } = await context.params;

    const note = await prisma.studentNote.findUnique({ where: { id: noteId } });
    if (!note || note.studentId !== session.user.studentProfileId) {
      throw new ForbiddenError("This note does not belong to you");
    }

    await prisma.studentNote.delete({ where: { id: noteId } });
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
