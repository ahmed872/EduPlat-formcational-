import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkVideoAccess } from "@/lib/business/video-access";
import { requireRole, toErrorResponse } from "@/lib/rbac";

const bodySchema = z.object({
  videoId: z.string(),
  timestampSeconds: z.number().int().min(0),
  content: z.string().min(1).max(2000),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const data = bodySchema.parse(await request.json());

    // Annotating a video requires being able to watch it — otherwise any
    // videoId (including an unpublished one) could be attached to, and its
    // title then surfaced back in the student's saved moments.
    const access = await checkVideoAccess(prisma, {
      studentId: session.user.studentProfileId!,
      videoId: data.videoId,
    });
    if (!access.allowed && access.reason !== "VIEW_LIMIT_REACHED") {
      return Response.json({ error: "لا تملك صلاحية الوصول إلى هذا الفيديو" }, { status: 403 });
    }

    const note = await prisma.studentNote.create({
      data: {
        studentId: session.user.studentProfileId!,
        videoId: data.videoId,
        timestampSeconds: data.timestampSeconds,
        content: data.content,
      },
    });

    return Response.json(note, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
