import type { AnnouncementAudience, PrismaClient } from "@prisma/client";
import { notify } from "@/lib/business/notifications";

/**
 * AnnouncementAudience.GROUP has no backing model anywhere in the schema
 * (no Group/StudentGroup table exists) — rather than fabricate a group
 * concept, it is rejected here as genuinely unsupported instead of
 * silently resolving to zero recipients.
 */
const SUPPORTED_AUDIENCES: AnnouncementAudience[] = ["ALL", "CATEGORY", "COURSE", "STUDENT"];

/**
 * The same "enrolled" definition analytics.ts already uses: a real
 * Entitlement or WatchSession row, since a free lesson never creates an
 * Entitlement — a student who only ever watched free content must still
 * count as enrolled for a course-targeted announcement to reach them.
 */
async function getEnrolledStudentIdsForCourse(prisma: PrismaClient, courseId: string) {
  const [entitlements, watchSessions] = await Promise.all([
    prisma.entitlement.findMany({
      where: { revokedAt: null, lesson: { courseId } },
      select: { studentId: true },
    }),
    prisma.watchSession.findMany({
      where: { video: { lesson: { courseId } } },
      select: { studentId: true },
    }),
  ]);
  return Array.from(
    new Set([...entitlements.map((e) => e.studentId), ...watchSessions.map((w) => w.studentId)]),
  );
}

async function getEnrolledStudentIdsForCategory(prisma: PrismaClient, categoryId: string) {
  const courses = await prisma.course.findMany({ where: { categoryId }, select: { id: true } });
  const perCourse = await Promise.all(
    courses.map((c) => getEnrolledStudentIdsForCourse(prisma, c.id)),
  );
  return Array.from(new Set(perCourse.flat()));
}

/**
 * Resolves an announcement's audience into real StudentProfile ids —
 * never a fabricated/guessed list.
 */
export async function resolveAnnouncementStudentIds(
  prisma: PrismaClient,
  params: { audienceType: AnnouncementAudience; audienceRefId: string | null },
): Promise<string[]> {
  if (params.audienceType === "ALL") {
    const students = await prisma.studentProfile.findMany({ select: { id: true } });
    return students.map((s) => s.id);
  }
  if (params.audienceType === "STUDENT") {
    return params.audienceRefId ? [params.audienceRefId] : [];
  }
  if (params.audienceType === "COURSE") {
    return params.audienceRefId ? getEnrolledStudentIdsForCourse(prisma, params.audienceRefId) : [];
  }
  if (params.audienceType === "CATEGORY") {
    return params.audienceRefId ? getEnrolledStudentIdsForCategory(prisma, params.audienceRefId) : [];
  }
  throw new Error(`نوع جمهور غير مدعوم: ${params.audienceType} — لا يوجد نموذج مجموعات في قاعدة البيانات`);
}

/**
 * Creates the permanent Announcement record and immediately fans out a
 * real Notification (via the same notify() every other phase already
 * uses) to every resolved recipient — an announcement a student never
 * sees a notification for would be a silent, easy-to-miss feature.
 */
export async function publishAnnouncement(
  prisma: PrismaClient,
  params: {
    teacherId: string;
    title: string;
    body: string;
    audienceType: AnnouncementAudience;
    audienceRefId: string | null;
  },
) {
  if (!SUPPORTED_AUDIENCES.includes(params.audienceType)) {
    throw new Error(`نوع جمهور غير مدعوم: ${params.audienceType}`);
  }
  if (params.audienceType !== "ALL" && !params.audienceRefId) {
    throw new Error("هذا النوع من الإعلانات يتطلب تحديد الجمهور المستهدف");
  }

  const announcement = await prisma.announcement.create({
    data: {
      teacherId: params.teacherId,
      title: params.title,
      body: params.body,
      audienceType: params.audienceType,
      audienceRefId: params.audienceRefId,
    },
  });

  const studentIds = await resolveAnnouncementStudentIds(prisma, params);
  const students = await prisma.studentProfile.findMany({
    where: { id: { in: studentIds } },
    select: { userId: true },
  });

  for (const student of students) {
    await notify(prisma, {
      userId: student.userId,
      type: "ANNOUNCEMENT",
      title: params.title,
      body: params.body,
      metadata: { announcementId: announcement.id },
    });
  }

  return { announcement, notifiedCount: students.length };
}

export async function getAnnouncementsForTeacher(prisma: PrismaClient) {
  return prisma.announcement.findMany({ orderBy: { createdAt: "desc" } });
}

/**
 * A student sees: ALL-audience announcements, any COURSE/CATEGORY
 * announcement for a course they're really enrolled in, and any
 * STUDENT-targeted announcement addressed to them specifically.
 */
export async function getAnnouncementsForStudent(prisma: PrismaClient, studentId: string) {
  const [allAnnouncements, entitlements, watchSessions] = await Promise.all([
    prisma.announcement.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.entitlement.findMany({
      where: { studentId, revokedAt: null, lessonId: { not: null } },
      include: { lesson: true },
    }),
    prisma.watchSession.findMany({
      where: { studentId },
      include: { video: { include: { lesson: true } } },
    }),
  ]);

  const enrolledCourseIds = new Set(
    [
      ...entitlements.map((e) => e.lesson?.courseId),
      ...watchSessions.map((w) => w.video.lesson?.courseId),
    ].filter((id): id is string => Boolean(id)),
  );
  const enrolledCategoryIds = new Set(
    (
      await prisma.course.findMany({
        where: { id: { in: Array.from(enrolledCourseIds) } },
        select: { categoryId: true },
      })
    ).map((c) => c.categoryId),
  );

  return allAnnouncements.filter((a) => {
    if (a.audienceType === "ALL") return true;
    if (a.audienceType === "STUDENT") return a.audienceRefId === studentId;
    if (a.audienceType === "COURSE") return a.audienceRefId ? enrolledCourseIds.has(a.audienceRefId) : false;
    if (a.audienceType === "CATEGORY") return a.audienceRefId ? enrolledCategoryIds.has(a.audienceRefId) : false;
    return false;
  });
}

/**
 * A parent sees ALL-audience announcements plus any STUDENT-targeted
 * announcement addressed to one of their own *approved* children —
 * course/category announcements are scoped to enrolled students, not
 * their parents, since the parent isn't the one taking the course.
 */
export async function getAnnouncementsForParent(prisma: PrismaClient, parentId: string) {
  const [allAnnouncements, approvedLinks] = await Promise.all([
    prisma.announcement.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.parentStudent.findMany({
      where: { parentId, approvedAt: { not: null } },
      select: { studentId: true },
    }),
  ]);
  const approvedStudentIds = new Set(approvedLinks.map((l) => l.studentId));

  return allAnnouncements.filter((a) => {
    if (a.audienceType === "ALL") return true;
    if (a.audienceType === "STUDENT") return a.audienceRefId ? approvedStudentIds.has(a.audienceRefId) : false;
    return false;
  });
}
