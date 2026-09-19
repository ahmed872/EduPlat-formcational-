import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAnnouncementsForParent } from "@/lib/business/announcements";

export default async function ParentAnnouncementsPage() {
  const session = await auth();
  const parentProfile = await prisma.parentProfile.findUniqueOrThrow({
    where: { userId: session!.user.id },
  });
  const announcements = await getAnnouncementsForParent(prisma, parentProfile.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">الإعلانات</h1>
      <div className="flex flex-col gap-2">
        {announcements.map((announcement) => (
          <div key={announcement.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-semibold">{announcement.title}</p>
            <p className="mt-1 text-sm text-gray-600">{announcement.body}</p>
            <p className="mt-2 text-xs text-gray-400">
              {announcement.createdAt.toLocaleDateString("ar-EG")}
            </p>
          </div>
        ))}
        {announcements.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد إعلانات حاليًا.</p>
        )}
      </div>
    </div>
  );
}
