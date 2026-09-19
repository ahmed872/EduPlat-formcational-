import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTeacherProfile } from "@/lib/business/teacher-profile";
import { saveProfile } from "./actions";

export default async function TeacherProfilePage() {
  const session = await auth();
  const { profile, courses } = await getTeacherProfile(prisma, session!.user.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">ملفي الشخصي</h1>
        <p className="mt-1 text-sm text-gray-600">
          يظهر هذا الملف علنًا للطلاب على{" "}
          <a href={`/teachers/${session!.user.id}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
            الصفحة العامة
          </a>
          .
        </p>
      </div>

      <form action={saveProfile} className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">رابط الصورة الشخصية (اختياري)</span>
          <input
            name="photoUrl"
            type="url"
            defaultValue={profile?.photoUrl ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">نبذة تعريفية</span>
          <textarea
            name="bio"
            rows={3}
            defaultValue={profile?.bio ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">المؤهل العلمي</span>
          <input
            name="education"
            defaultValue={profile?.education ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الخبرة</span>
          <textarea
            name="experience"
            rows={2}
            defaultValue={profile?.experience ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">فلسفتي في التدريس</span>
          <textarea
            name="philosophy"
            rows={2}
            defaultValue={profile?.philosophy ?? ""}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          حفظ
        </button>
      </form>

      <div>
        <h2 className="mb-2 text-lg font-bold">كورساتي المنشورة ({courses.length})</h2>
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
    </div>
  );
}
