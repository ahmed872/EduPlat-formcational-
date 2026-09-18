import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, toErrorResponse } from "@/lib/rbac";

const bodySchema = z.object({
  videoId: z.string(),
  timestampSeconds: z.number().int().min(0),
  label: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    requireRole(session, ["STUDENT"]);
    const data = bodySchema.parse(await request.json());

    const bookmark = await prisma.bookmark.create({
      data: {
        studentId: session.user.studentProfileId!,
        videoId: data.videoId,
        timestampSeconds: data.timestampSeconds,
        label: data.label,
      },
    });

    return Response.json(bookmark, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
