import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createCourse } from "./actions";

export default async function CoursesPage() {
  const [courses, categories] = await Promise.all([
    prisma.course.findMany({
      include: { category: true, lessons: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.category.findMany({ where: { archived: false } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">الكورسات</h1>

      <form
        action={createCourse}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">عنوان الكورس</span>
          <input
            name="title"
            required
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">القسم</span>
          <select
            name="categoryId"
            required
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">اختر قسمًا</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">العام الدراسي</span>
          <input
            name="academicYear"
            required
            placeholder="2026"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إنشاء كورس
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <Link
            key={course.id}
            href={`/teacher/courses/${course.id}`}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-indigo-300"
          >
            <p className="text-xs text-gray-500">{course.category.name}</p>
            <p className="mt-1 font-semibold">{course.title}</p>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>{course.lessons.length} درس</span>
              <span
                className={
                  course.status === "PUBLISHED"
                    ? "rounded-full bg-green-100 px-2 py-0.5 text-green-700"
                    : "rounded-full bg-gray-100 px-2 py-0.5 text-gray-600"
                }
              >
                {course.status === "PUBLISHED" ? "منشور" : "مسودة"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
