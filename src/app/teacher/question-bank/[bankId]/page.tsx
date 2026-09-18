import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createQuestion, deleteQuestion } from "../actions";

const TYPE_LABELS: Record<string, string> = {
  SINGLE_CHOICE: "اختيار واحد",
  MULTIPLE_CHOICE: "اختيار متعدد",
  TRUE_FALSE: "صح/خطأ",
  MATCHING: "توصيل (بالترتيب)",
  SHORT_ANSWER: "إجابة قصيرة (تصحيح يدوي)",
  ESSAY: "مقالي (تصحيح يدوي)",
};

export default async function QuestionBankDetailPage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const bank = await prisma.questionBank.findUnique({
    where: { id: bankId },
    include: { questions: { orderBy: { createdAt: "desc" } } },
  });
  if (!bank) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{bank.name}</h1>
        {bank.description && <p className="text-sm text-gray-600">{bank.description}</p>}
      </div>

      <form
        action={createQuestion.bind(null, bank.id)}
        className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">نوع السؤال</span>
            <select name="type" required className="rounded-md border border-gray-300 px-3 py-2">
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">مستوى الصعوبة</span>
            <select
              name="difficulty"
              className="rounded-md border border-gray-300 px-3 py-2"
              defaultValue="MEDIUM"
            >
              <option value="EASY">سهل</option>
              <option value="MEDIUM">متوسط</option>
              <option value="HARD">صعب</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">نص السؤال</span>
          <textarea
            name="prompt"
            required
            rows={2}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">
            الخيارات (مفصولة بفاصلة — غير مطلوبة للأسئلة المقالية/الإجابة القصيرة)
          </span>
          <input
            name="options"
            placeholder="القاهرة, الإسكندرية, أسوان"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">
            الإجابة الصحيحة (لاختيار متعدد: افصل الإجابات بفاصلة)
          </span>
          <input
            name="correctAnswer"
            placeholder="القاهرة"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الوسوم (اختياري، مفصولة بفاصلة)</span>
          <input name="tags" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <button
          type="submit"
          className="self-start rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إضافة سؤال
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {bank.questions.map((question) => (
          <div
            key={question.id}
            className="flex items-start justify-between rounded-lg border border-gray-200 bg-white p-4"
          >
            <div>
              <p className="font-medium">{question.prompt}</p>
              <p className="mt-1 text-xs text-gray-500">
                {TYPE_LABELS[question.type]} · {question.difficulty}
                {question.tags.length > 0 && ` · ${question.tags.join(", ")}`}
              </p>
            </div>
            <form action={deleteQuestion.bind(null, bank.id, question.id)}>
              <button type="submit" className="text-xs text-red-500 hover:underline">
                حذف
              </button>
            </form>
          </div>
        ))}
        {bank.questions.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد أسئلة في هذا البنك بعد.</p>
        )}
      </div>
    </div>
  );
}
