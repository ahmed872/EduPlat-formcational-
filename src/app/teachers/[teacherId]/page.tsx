import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getTeacherProfile } from "@/lib/business/teacher-profile";

export default async function PublicTeacherProfilePage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;
  const { profile, courses } = await getTeacherProfile(prisma, teacherId);
  if (!profile) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <div className="flex items-center gap-4">
        {profile.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.photoUrl}
            alt={profile.user.name}
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200 text-2xl">
            {profile.user.name.charAt(0)}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">{profile.user.name}</h1>
          {profile.education && <p className="text-sm text-gray-600">{profile.education}</p>}
        </div>
      </div>

      {profile.bio && (
        <div>
          <h2 className="mb-1 font-semibold">نبذة</h2>
          <p className="text-sm text-gray-700">{profile.bio}</p>
        </div>
      )}
      {profile.experience && (
        <div>
          <h2 className="mb-1 font-semibold">الخبرة</h2>
          <p className="text-sm text-gray-700">{profile.experience}</p>
        </div>
      )}
      {profile.philosophy && (
        <div>
          <h2 className="mb-1 font-semibold">فلسفة التدريس</h2>
          <p className="text-sm text-gray-700">{profile.philosophy}</p>
        </div>
      )}

      <div>
        <h2 className="mb-2 font-semibold">الكورسات المنشورة ({courses.length})</h2>
        <div className="flex flex-col gap-2">
          {courses.map((course) => (
            <div key={course.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
              {course.title} — <span className="text-gray-500">{course.category.name}</span>
            </div>
          ))}
          {courses.length === 0 && (
            <p className="text-sm text-gray-500">لا توجد كورسات منشورة بعد.</p>
          )}
        </div>
      </div>
    </main>
  );
}
