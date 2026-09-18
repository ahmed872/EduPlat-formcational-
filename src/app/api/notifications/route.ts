import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireSession, toErrorResponse } from "@/lib/rbac";

export async function GET() {
  try {
    const session = await auth();
    requireSession(session);

    const notifications = await prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const unreadCount = await prisma.notification.count({
      where: { userId: session.user.id, readAt: null },
    });

    return Response.json({ notifications, unreadCount });
  } catch (error) {
    return toErrorResponse(error);
  }
}
