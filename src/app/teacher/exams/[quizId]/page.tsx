import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { addQuestionToExam, removeQuestionFromExam } from "../actions";

export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ quizId: string }>;
}) {
  const { quizId } = await params;
  const [quiz, banks, attempts] = await Promise.all([
    prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        quizQuestions: {
          include: { question: true },
          orderBy: { order: "asc" },
        },
        lesson: true,
      },
    }),
    prisma.questionBank.findMany({ include: { questions: true } }),
    prisma.quizAttempt.findMany({
      where: { quizId },
      include: { student: { include: { user: true } } },
      orderBy: { submittedAt: "desc" },
    }),
  ]);
  if (!quiz) notFound();

  const gradedAttempts = attempts.filter((a) => a.status === "GRADED");
  const averagePercentage = gradedAttempts.length
    ? gradedAttempts.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / gradedAttempts.length
    : null;
  const passRate = gradedAttempts.length
    ? (gradedAttempts.filter((a) => a.passed).length / gradedAttempts.length) * 100
    : null;

  const attachedIds = new Set(quiz.quizQuestions.map((qq) => qq.questionId));
  const availableQuestions = banks.flatMap((bank) =>
    bank.questions
      .filter((q) => !attachedIds.has(q.id))
      .map((q) => ({ ...q, bankName: bank.name })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{quiz.title}</h1>
        <p className="text-sm text-gray-600">
          درجة النجاح: {quiz.passingScore}% · محاولات: {quiz.maxAttempts}
          {quiz.timeLimitMinutes && ` · المدة: ${quiz.timeLimitMinutes} دقيقة`}
          {quiz.questionCount && ` · عدد أسئلة عشوائي: ${quiz.questionCount}`}
          {quiz.lesson && ` · درس: ${quiz.lesson.title}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">عدد المحاولات</p>
          <p className="mt-1 text-2xl font-bold">{attempts.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">متوسط الدرجات</p>
          <p className="mt-1 text-2xl font-bold">
            {averagePercentage !== null ? `${averagePercentage.toFixed(0)}%` : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">نسبة النجاح</p>
          <p className="mt-1 text-2xl font-bold">
            {passRate !== null ? `${passRate.toFixed(0)}%` : "—"}
          </p>
        </div>
      </div>

      {attempts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-right text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">الطالب</th>
                <th className="px-4 py-2">الحالة</th>
                <th className="px-4 py-2">النتيجة</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{attempt.student.user.name}</td>
                  <td className="px-4 py-2">
                    {attempt.status === "GRADED"
                      ? "تم التصحيح"
                      : attempt.status === "SUBMITTED"
                        ? "بانتظار التصحيح"
                        : "قيد التنفيذ"}
                  </td>
                  <td className="px-4 py-2">
                    {attempt.percentage !== null ? `${attempt.percentage.toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">أسئلة الامتحان</h2>
        <ul className="flex flex-col gap-2">
          {quiz.quizQuestions.map((qq) => (
            <li
              key={qq.id}
              className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2"
            >
              <span>
                {qq.question.prompt} <span className="text-xs text-gray-500">({qq.points} نقطة)</span>
              </span>
              <form action={removeQuestionFromExam.bind(null, quizId, qq.id)}>
                <button type="submit" className="text-xs text-red-500 hover:underline">
                  إزالة
                </button>
              </form>
            </li>
          ))}
          {quiz.quizQuestions.length === 0 && (
            <li className="text-sm text-gray-500">لا توجد أسئلة مضافة بعد.</li>
          )}
        </ul>
      </div>

      <form
        action={addQuestionToExam.bind(null, quizId)}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">اختر سؤالًا من بنك الأسئلة</span>
          <select
            name="questionId"
            required
            className="min-w-80 rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">اختر سؤالًا</option>
            {availableQuestions.map((question) => (
              <option key={question.id} value={question.id}>
                [{question.bankName}] {question.prompt}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">النقاط</span>
          <input
            type="number"
            name="points"
            defaultValue={1}
            min="1"
            className="w-20 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إضافة
        </button>
      </form>
    </div>
  );
}
