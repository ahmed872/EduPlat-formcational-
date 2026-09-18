import { prisma } from "@/lib/prisma";
import { gradeAnswer } from "./actions";

export default async function GradingQueuePage() {
  const ungradedAnswers = await prisma.quizAnswer.findMany({
    where: { isCorrect: null },
    include: {
      question: true,
      attempt: {
        include: { quiz: true, student: { include: { user: true } } },
      },
    },
    orderBy: { id: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">قائمة التصحيح اليدوي</h1>
        <p className="mt-1 text-sm text-gray-600">
          الأسئلة المقالية وذات الإجابة القصيرة تحتاج تصحيحًا يدويًا — نتيجة
          الامتحان لا تُحسب نهائيًا حتى تُصحَّح كل الأسئلة.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {ungradedAnswers.map((answer) => (
          <div key={answer.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">
              {answer.attempt.quiz.title} · {answer.attempt.student.user.name}
            </p>
            <p className="mt-1 font-medium">{answer.question.prompt}</p>
            <div className="mt-2 rounded-md bg-gray-50 p-3 text-sm">
              {typeof answer.studentAnswer === "string"
                ? answer.studentAnswer
                : JSON.stringify(answer.studentAnswer)}
            </div>
            <form
              action={gradeAnswer.bind(null, answer.id)}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-600">الدرجة</span>
                <input
                  type="number"
                  name="pointsAwarded"
                  min="0"
                  step="0.5"
                  required
                  className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-600">ملاحظات (اختياري)</span>
                <input
                  name="feedback"
                  className="min-w-56 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
              >
                حفظ التصحيح
              </button>
            </form>
          </div>
        ))}
        {ungradedAnswers.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد إجابات بانتظار التصحيح.</p>
        )}
      </div>
    </div>
  );
}
