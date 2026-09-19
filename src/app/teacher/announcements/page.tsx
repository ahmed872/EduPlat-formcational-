import { prisma } from "@/lib/prisma";
import { getAnnouncementsForTeacher } from "@/lib/business/announcements";
import { createAnnouncement } from "./actions";

const AUDIENCE_LABELS: Record<string, string> = {
  ALL: "كل الطلاب",
  CATEGORY: "قسم معين",
  COURSE: "كورس معين",
  STUDENT: "طالب معين",
};

export default async function TeacherAnnouncementsPage() {
  const [announcements, categories, courses, students] = await Promise.all([
    getAnnouncementsForTeacher(prisma),
    prisma.category.findMany({ where: { archived: false } }),
    prisma.course.findMany({ where: { status: "PUBLISHED" } }),
    prisma.studentProfile.findMany({ include: { user: true } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الإعلانات</h1>
        <p className="mt-1 text-sm text-gray-600">
          كل إعلان يصل فعليًا كإشعار حقيقي (🔔) لكل طالب ضمن الجمهور المستهدف — وليس مجرد نص معروض هنا.
        </p>
      </div>

      <form
        action={createAnnouncement}
        className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">العنوان</span>
          <input name="title" required className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">النص</span>
          <textarea name="body" required rows={3} className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الجمهور</span>
          <select name="audienceType" required className="rounded-md border border-gray-300 px-3 py-2">
            {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">القسم (عند اختيار &quot;قسم معين&quot;)</span>
            <select name="audienceCategoryId" className="min-w-56 rounded-md border border-gray-300 px-3 py-2">
              <option value="">— اختر قسمًا —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">الكورس (عند اختيار &quot;كورس معين&quot;)</span>
            <select name="audienceCourseId" className="min-w-56 rounded-md border border-gray-300 px-3 py-2">
              <option value="">— اختر كورسًا —</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">الطالب (عند اختيار &quot;طالب معين&quot;)</span>
            <select name="audienceStudentId" className="min-w-56 rounded-md border border-gray-300 px-3 py-2">
              <option value="">— اختر طالبًا —</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.user.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          نشر الإعلان
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {announcements.map((announcement) => (
          <div key={announcement.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{announcement.title}</p>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {AUDIENCE_LABELS[announcement.audienceType]}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{announcement.body}</p>
            <p className="mt-2 text-xs text-gray-400">
              {announcement.createdAt.toLocaleDateString("ar-EG")}
            </p>
          </div>
        ))}
        {announcements.length === 0 && <p className="text-sm text-gray-500">لا توجد إعلانات بعد.</p>}
      </div>
    </div>
  );
}
