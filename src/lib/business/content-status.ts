import type { ContentStatus, PrismaClient, UserRole } from "@prisma/client";

export type ContentKind = "COURSE" | "LESSON" | "VIDEO";

const STATUSES: ContentStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

/**
 * The teacher's Publish / Unpublish (→ DRAFT) / Archive control for a course,
 * lesson or video. Authorization is enforced here, not only by the calling
 * server action. Entitlement rows are never touched: unpublishing or
 * archiving changes visibility (see content-visibility.ts), not ownership.
 */
export async function setContentStatus(
  prisma: PrismaClient,
  params: { actorRole: UserRole; kind: ContentKind; id: string; status: ContentStatus },
) {
  if (params.actorRole !== "TEACHER_ADMIN") {
    throw new Error("غير مصرح لك بتغيير حالة المحتوى");
  }
  if (!STATUSES.includes(params.status)) {
    throw new Error("حالة غير صالحة");
  }

  switch (params.kind) {
    case "COURSE":
      return prisma.course.update({ where: { id: params.id }, data: { status: params.status } });
    case "LESSON": {
      const lesson = await prisma.lesson.findUniqueOrThrow({ where: { id: params.id } });
      return prisma.lesson.update({
        where: { id: params.id },
        data: {
          status: params.status,
          ...(params.status === "PUBLISHED" && !lesson.releaseAt ? { releaseAt: new Date() } : {}),
        },
      });
    }
    case "VIDEO":
      return prisma.video.update({ where: { id: params.id }, data: { status: params.status } });
    default:
      throw new Error("نوع محتوى غير صالح");
  }
}
