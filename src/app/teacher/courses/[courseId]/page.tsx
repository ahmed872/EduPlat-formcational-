import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  createLesson,
  publishCourse,
  publishLesson,
} from "../actions";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      category: true,
      lessons: {
        orderBy: { order: "asc" },
        include: { video: true, requiredPreviousLesson: true },
      },
    },
  });
  if (!course) notFound();

  const createLessonWithCourse = createLesson.bind(null, courseId);
  const publishCourseAction = publishCourse.bind(null, courseId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{course.category.name}</p>
          <h1 className="text-2xl font-bold">{course.title}</h1>
        </div>
        {course.status !== "PUBLISHED" && (
          <form action={publishCourseAction}>
            <button
              type="submit"
              className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700"
            >
              نشر الكورس
            </button>
          </form>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">الدروس</h2>
        <ul className="flex flex-col gap-2">
          {course.lessons.map((lesson) => (
            <li
              key={lesson.id}
              className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2"
            >
              <div>
                <p className="font-medium">{lesson.title}</p>
                <p className="text-xs text-gray-500">
                  {lesson.isFree ? "مجاني" : "مدفوع"}
                  {lesson.requiredPreviousLesson
                    ? ` · يتطلب اجتياز: ${lesson.requiredPreviousLesson.title}`
                    : ""}
                  {lesson.video ? " · يحتوي على فيديو" : " · بدون فيديو بعد"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={
                    lesson.status === "PUBLISHED"
                      ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                      : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                  }
                >
                  {lesson.status === "PUBLISHED" ? "منشور" : "مسودة"}
                </span>
                {lesson.status !== "PUBLISHED" && (
                  <form action={publishLesson.bind(null, courseId, lesson.id)}>
                    <button
                      type="submit"
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      نشر
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
          {course.lessons.length === 0 && (
            <li className="text-sm text-gray-500">لا توجد دروس بعد.</li>
          )}
        </ul>
      </div>

      <form
        action={createLessonWithCourse}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">عنوان الدرس</span>
          <input
            name="title"
            required
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الدرس المطلوب اجتيازه أولًا</span>
          <select
            name="requiredPreviousLessonId"
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">— بدون —</option>
            {course.lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="isFree" />
          <span className="text-sm text-gray-600">درس مجاني</span>
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إضافة درس
        </button>
      </form>
    </div>
  );
}
