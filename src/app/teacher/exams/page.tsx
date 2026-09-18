import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createExam } from "./actions";

const EXAM_TYPE_LABELS: Record<string, string> = {
  WEEKLY: "أسبوعي",
  MONTHLY: "شهري",
  MIDTERM: "منتصف الفصل",
  FINAL: "نهائي",
  CUSTOM: "مخصص",
};

export default async function ExamsListPage() {
  const exams = await prisma.quiz.findMany({
    where: { examType: { not: "LESSON_QUIZ" } },
    include: { quizQuestions: true, attempts: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">الامتحانات (أسبوعية / شهرية / نهائية / مخصصة)</h1>

      <form
        action={createExam}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">العنوان</span>
          <input
            name="title"
            required
            className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">النوع</span>
          <select name="examType" required className="rounded-md border border-gray-300 px-3 py-2">
            {Object.entries(EXAM_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">درجة النجاح %</span>
          <input
            type="number"
            name="passingScore"
            defaultValue={60}
            min="0"
            max="100"
            className="w-24 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">عدد المحاولات</span>
          <input
            type="number"
            name="maxAttempts"
            defaultValue={1}
            min="1"
            className="w-20 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">مدة الامتحان (دقيقة)</span>
          <input
            type="number"
            name="timeLimitMinutes"
            min="1"
            className="w-24 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">عدد الأسئلة العشوائي (اختياري)</span>
          <input
            type="number"
            name="questionCount"
            min="1"
            className="w-24 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="randomizeQuestions" />
          <span className="text-sm text-gray-600">ترتيب عشوائي</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">يبدأ من</span>
          <input
            type="datetime-local"
            name="availableFrom"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">ينتهي في</span>
          <input
            type="datetime-local"
            name="availableTo"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إنشاء امتحان
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {exams.map((exam) => (
          <Link
            key={exam.id}
            href={`/teacher/exams/${exam.id}`}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300"
          >
            <p className="font-semibold">{exam.title}</p>
            <p className="mt-1 text-xs text-gray-500">
              {EXAM_TYPE_LABELS[exam.examType] ?? exam.examType} · {exam.quizQuestions.length} سؤال
              · {exam.attempts.length} محاولة
            </p>
          </Link>
        ))}
        {exams.length === 0 && <p className="text-sm text-gray-500">لا توجد امتحانات بعد.</p>}
      </div>
    </div>
  );
}
