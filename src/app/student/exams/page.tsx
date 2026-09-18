import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const EXAM_TYPE_LABELS: Record<string, string> = {
  WEEKLY: "أسبوعي",
  MONTHLY: "شهري",
  MIDTERM: "منتصف الفصل",
  FINAL: "نهائي",
  CUSTOM: "مخصص",
};

export default async function StudentExamsPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const exams = await prisma.quiz.findMany({
    where: { examType: { not: "LESSON_QUIZ" } },
    orderBy: { createdAt: "desc" },
  });

  const attempts = await prisma.quizAttempt.findMany({
    where: { studentId, quizId: { in: exams.map((e) => e.id) } },
  });
  const attemptsByQuiz = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    attemptsByQuiz.set(attempt.quizId, [...(attemptsByQuiz.get(attempt.quizId) ?? []), attempt]);
  }

  const now = new Date();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold">الامتحانات</h1>
      <div className="flex flex-col gap-3">
        {exams.map((exam) => {
          const myAttempts = attemptsByQuiz.get(exam.id) ?? [];
          const bestGraded = myAttempts
            .filter((a) => a.status === "GRADED")
            .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
          const notYetOpen = exam.availableFrom && now < exam.availableFrom;
          const closed = exam.availableTo && now > exam.availableTo;

          return (
            <div key={exam.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{exam.title}</p>
                  <p className="text-xs text-gray-500">
                    {EXAM_TYPE_LABELS[exam.examType] ?? exam.examType}
                    {exam.timeLimitMinutes && ` · ${exam.timeLimitMinutes} دقيقة`}
                  </p>
                </div>
                {notYetOpen ? (
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                    يبدأ لاحقًا
                  </span>
                ) : closed ? (
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                    انتهى
                  </span>
                ) : (
                  <Link
                    href={`/student/exams/${exam.id}`}
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                  >
                    {myAttempts.length > 0 ? "عرض / محاولة جديدة" : "بدء الامتحان"}
                  </Link>
                )}
              </div>
              {bestGraded && (
                <p className="mt-2 text-xs text-gray-500">
                  أفضل نتيجة: {bestGraded.percentage?.toFixed(0)}% —{" "}
                  {bestGraded.passed ? "ناجح" : "راسب"}
                </p>
              )}
            </div>
          );
        })}
        {exams.length === 0 && <p className="text-sm text-gray-500">لا توجد امتحانات متاحة.</p>}
      </div>
    </div>
  );
}
