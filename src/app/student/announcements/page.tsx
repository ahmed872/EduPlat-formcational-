import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAnnouncementsForStudent } from "@/lib/business/announcements";

export default async function StudentAnnouncementsPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;
  const announcements = await getAnnouncementsForStudent(prisma, studentId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">الإعلانات</h1>
      <div className="flex flex-col gap-2">
        {announcements.map((announcement) => (
          <div key={announcement.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-semibold">{announcement.title}</p>
            <p className="mt-1 text-sm text-gray-600">{announcement.body}</p>
            <p className="mt-2 text-xs text-gray-500">
              {announcement.createdAt.toLocaleDateString("ar-EG")}
            </p>
          </div>
        ))}
        {announcements.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد إعلانات لك حاليًا.</p>
        )}
      </div>
    </div>
  );
}
