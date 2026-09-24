import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  addVideoChapter,
  createExperiment,
  createLesson,
  deleteExperiment,
  deleteVideoChapter,
  uploadLessonVideo,
} from "../actions";
import { StatusControls } from "./status-controls";

const EXPERIMENT_TYPE_LABELS: Record<string, string> = {
  SIMULATION: "محاكاة",
  DRAG_AND_DROP: "سحب وإفلات",
  MINI_GAME: "لعبة تعليمية",
  INTERACTIVE: "تفاعلية",
};

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
        include: {
          video: { include: { chapters: { orderBy: { order: "asc" } } } },
          requiredPreviousLesson: true,
          experiments: { orderBy: { order: "asc" } },
        },
      },
    },
  });
  if (!course) notFound();

  const createLessonWithCourse = createLesson.bind(null, courseId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{course.category.name}</p>
          <h1 className="text-2xl font-bold">{course.title}</h1>
        </div>
        <StatusControls
          courseId={courseId}
          kind="COURSE"
          id={course.id}
          status={course.status}
          publishLabel="نشر الكورس"
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">الدروس</h2>
        {course.lessons.map((lesson) => (
          <div
            key={lesson.id}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{lesson.title}</p>
                <p className="text-xs text-gray-500">
                  {lesson.isFree ? "مجاني" : "مدفوع"}
                  {lesson.requiredPreviousLesson
                    ? ` · يتطلب اجتياز: ${lesson.requiredPreviousLesson.title}`
                    : ""}
                </p>
              </div>
              <StatusControls courseId={courseId} kind="LESSON" id={lesson.id} status={lesson.status} />
            </div>

            <div className="mt-3 border-t border-gray-100 pt-3">
              {lesson.video ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    ✓ يوجد فيديو مرفوع ({Math.round((lesson.video.durationSeconds ?? 0) / 60)}{" "}
                    دقيقة) — يمكن استبداله برفع ملف جديد أدناه.
                  </p>
                  <StatusControls
                    courseId={courseId}
                    kind="VIDEO"
                    id={lesson.video.id}
                    status={lesson.video.status}
                  />
                </div>
              ) : (
                <p className="text-xs text-amber-600">لا يوجد فيديو مرفوع لهذا الدرس بعد.</p>
              )}
              <form
                action={uploadLessonVideo.bind(null, courseId, lesson.id)}
                className="mt-2 flex flex-wrap items-end gap-2"
              >
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-600">ملف الفيديو</span>
                  <input
                    type="file"
                    name="video"
                    accept="video/mp4,video/webm,video/quicktime"
                    required
                    className="text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-600">عنوان الفيديو</span>
                  <input
                    name="title"
                    defaultValue={lesson.video?.title ?? lesson.title}
                    required
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-600">المدة (ثانية)</span>
                  <input
                    type="number"
                    name="durationSeconds"
                    min="1"
                    defaultValue={lesson.video?.durationSeconds ?? undefined}
                    required
                    className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex items-center gap-1 pb-1">
                  <input
                    type="checkbox"
                    name="isFree"
                    defaultChecked={lesson.video?.isFree ?? lesson.isFree}
                  />
                  <span className="text-xs text-gray-600">فيديو مجاني</span>
                </label>
                <button
                  type="submit"
                  className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-900"
                >
                  {lesson.video ? "استبدال الفيديو" : "رفع الفيديو"}
                </button>
              </form>

              {lesson.video && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="mb-2 text-xs font-medium text-gray-600">
                    فصول الفيديو (نقاط زمنية)
                  </p>
                  <ul className="mb-2 flex flex-col gap-1">
                    {lesson.video.chapters.map((chapter) => (
                      <li
                        key={chapter.id}
                        className="flex items-center justify-between text-xs text-gray-600"
                      >
                        <span>
                          {Math.floor(chapter.timestampSeconds / 60)}:
                          {String(chapter.timestampSeconds % 60).padStart(2, "0")} —{" "}
                          {chapter.title}
                        </span>
                        <form action={deleteVideoChapter.bind(null, courseId, chapter.id)}>
                          <button type="submit" className="text-red-500 hover:underline">
                            حذف
                          </button>
                        </form>
                      </li>
                    ))}
                    {lesson.video.chapters.length === 0 && (
                      <li className="text-xs text-gray-400">لا توجد فصول بعد.</li>
                    )}
                  </ul>
                  <form
                    action={addVideoChapter.bind(null, courseId, lesson.video.id)}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-600">اللحظة (ثانية)</span>
                      <input
                        type="number"
                        name="timestampSeconds"
                        min="0"
                        required
                        className="w-24 rounded-md border border-gray-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-600">عنوان الفصل</span>
                      <input
                        name="title"
                        required
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-md bg-gray-200 px-3 py-1.5 text-xs hover:bg-gray-300"
                    >
                      إضافة فصل
                    </button>
                  </form>
                </div>
              )}

              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs font-medium text-gray-600">
                  التجارب التفاعلية
                </p>
                <ul className="mb-2 flex flex-col gap-1">
                  {lesson.experiments.map((experiment) => (
                    <li
                      key={experiment.id}
                      className="flex items-center justify-between text-xs text-gray-600"
                    >
                      <span>
                        [{EXPERIMENT_TYPE_LABELS[experiment.type] ?? experiment.type}]{" "}
                        {experiment.title}{" "}
                        {experiment.isRequired ? (
                          <span className="text-amber-600">(إلزامية)</span>
                        ) : (
                          <span className="text-gray-400">(اختيارية)</span>
                        )}
                      </span>
                      <form action={deleteExperiment.bind(null, courseId, experiment.id)}>
                        <button type="submit" className="text-red-500 hover:underline">
                          حذف
                        </button>
                      </form>
                    </li>
                  ))}
                  {lesson.experiments.length === 0 && (
                    <li className="text-xs text-gray-400">لا توجد تجارب بعد.</li>
                  )}
                </ul>
                <form
                  action={createExperiment.bind(null, courseId, lesson.id)}
                  className="flex flex-wrap items-end gap-2"
                >
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600">النوع</span>
                    <select
                      name="type"
                      required
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    >
                      {Object.entries(EXPERIMENT_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600">العنوان</span>
                    <input
                      name="title"
                      required
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex flex-1 basis-full flex-col gap-1">
                    <span className="text-xs text-gray-600">تعليمات التجربة</span>
                    <textarea
                      name="instructions"
                      required
                      rows={2}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex flex-1 basis-full flex-col gap-1">
                    <span className="text-xs text-gray-600">
                      خطوات (اختياري — سطر لكل خطوة)
                    </span>
                    <textarea
                      name="steps"
                      rows={2}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600">
                      رابط تجربة خارجي (اختياري)
                    </span>
                    <input
                      name="embedUrl"
                      type="url"
                      className="min-w-56 rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-1 pb-1">
                    <input type="checkbox" name="isRequired" defaultChecked />
                    <span className="text-xs text-gray-600">إلزامية قبل اختبار الدرس</span>
                  </label>
                  <button
                    type="submit"
                    className="rounded-md bg-gray-200 px-3 py-1.5 text-xs hover:bg-gray-300"
                  >
                    إضافة تجربة
                  </button>
                </form>
              </div>
            </div>
          </div>
        ))}
        {course.lessons.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد دروس بعد.</p>
        )}
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
