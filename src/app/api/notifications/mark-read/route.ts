import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireSession, toErrorResponse } from "@/lib/rbac";

const bodySchema = z.object({ id: z.string().optional(), all: z.boolean().optional() });

export async function POST(request: Request) {
  try {
    const session = await auth();
    requireSession(session);
    const { id, all } = bodySchema.parse(await request.json());

    if (all) {
      await prisma.notification.updateMany({
        where: { userId: session.user.id, readAt: null },
        data: { readAt: new Date() },
      });
    } else if (id) {
      await prisma.notification.updateMany({
        where: { id, userId: session.user.id },
        data: { readAt: new Date() },
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
