import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkLessonAvailability } from "@/lib/business/content-visibility";
import { canStartNewAttempt, getQuestionsForAttempt } from "@/lib/business/quiz";
import { startAttempt } from "./actions";
import { ExamRunner } from "./exam-runner";

export default async function StudentExamPage({
  params,
}: {
  params: Promise<{ quizId: string }>;
}) {
  const { quizId } = await params;
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz) notFound();

  // A lesson quiz is only reachable by students who can use its lesson
  // (published + entitled); startQuizAttempt enforces the same rule
  // server-side, this just avoids rendering an unpublished lesson's quiz.
  if (quiz.lessonId) {
    const availability = await checkLessonAvailability(prisma, {
      studentId,
      lessonId: quiz.lessonId,
    });
    if (!availability.allowed) {
      return (
        <div className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          هذا الاختبار غير متاح لك.
        </div>
      );
    }
  }

  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId, studentId },
    orderBy: { attemptNumber: "desc" },
  });
  const inProgress = attempts.find((a) => a.status === "IN_PROGRESS");
  const lastGraded = attempts.find((a) => a.status === "GRADED");

  const { allowed } = await canStartNewAttempt(prisma, { quizId, studentId });
  const startAction = startAttempt.bind(null, quizId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-bold">{quiz.title}</h1>

      {inProgress ? (
        <ExamRunner
          attemptId={inProgress.id}
          questions={await getQuestionsForAttempt(prisma, inProgress.id)}
          timeLimitMinutes={quiz.timeLimitMinutes}
          startedAt={inProgress.startedAt.toISOString()}
        />
      ) : (
        <>
          {lastGraded && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="font-medium">
                آخر نتيجة: {lastGraded.percentage?.toFixed(0)}% —{" "}
                {lastGraded.passed ? "ناجح" : "راسب"}
              </p>
            </div>
          )}
          {allowed ? (
            <form action={startAction}>
              <button
                type="submit"
                className="rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
              >
                {attempts.length > 0 ? "بدء محاولة جديدة" : "بدء الامتحان"}
              </button>
            </form>
          ) : (
            <p className="text-sm text-amber-700">
              لقد استنفدت عدد المحاولات المسموح بها لهذا الامتحان.
            </p>
          )}
        </>
      )}
    </div>
  );
}
