import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function LearningHistoryPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const completedLessons = await prisma.lessonProgress.findMany({
    where: { studentId, status: "COMPLETED" },
    include: { lesson: { include: { course: true } } },
    orderBy: { completedAt: "desc" },
  });

  const quizAttempts = await prisma.quizAttempt.findMany({
    where: { studentId, status: "GRADED" },
    include: { quiz: { include: { lesson: true } } },
    orderBy: { submittedAt: "desc" },
    take: 20,
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-bold">سجل التعلم</h1>

      <section>
        <h2 className="mb-3 text-lg font-semibold">الدروس المكتملة</h2>
        <div className="flex flex-col gap-2">
          {completedLessons.map((progress) => (
            <div
              key={progress.id}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{progress.lesson.title}</p>
                <p className="text-xs text-gray-500">{progress.lesson.course.title}</p>
              </div>
              <span className="text-xs text-gray-500">
                {progress.completedAt
                  ? new Date(progress.completedAt).toLocaleDateString("ar-EG")
                  : ""}
              </span>
            </div>
          ))}
          {completedLessons.length === 0 && (
            <p className="text-sm text-gray-500">لا توجد دروس مكتملة بعد.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">نتائج الاختبارات</h2>
        <div className="flex flex-col gap-2">
          {quizAttempts.map((attempt) => (
            <div
              key={attempt.id}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-2 text-sm"
            >
              <span>{attempt.quiz.title}</span>
              <span
                className={
                  attempt.passed
                    ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                    : "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
                }
              >
                {attempt.percentage?.toFixed(0)}% — {attempt.passed ? "ناجح" : "راسب"}
              </span>
            </div>
          ))}
          {quizAttempts.length === 0 && (
            <p className="text-sm text-gray-500">لا توجد نتائج اختبارات بعد.</p>
          )}
        </div>
      </section>
    </div>
  );
}
