import type { PrismaClient } from "@prisma/client";

export async function getTeacherProfile(prisma: PrismaClient, userId: string) {
  const [profile, courses] = await Promise.all([
    prisma.teacherProfile.findUnique({
      where: { userId },
      include: { user: true },
    }),
    prisma.course.findMany({
      where: { teacherId: userId, status: "PUBLISHED" },
      include: { category: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { profile, courses };
}

export async function updateTeacherProfile(
  prisma: PrismaClient,
  params: {
    userId: string;
    bio?: string | null;
    photoUrl?: string | null;
    education?: string | null;
    experience?: string | null;
    philosophy?: string | null;
  },
) {
  const data = {
    bio: params.bio ?? null,
    photoUrl: params.photoUrl ?? null,
    education: params.education ?? null,
    experience: params.experience ?? null,
    philosophy: params.philosophy ?? null,
  };

  return prisma.teacherProfile.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...data },
    update: data,
  });
}
