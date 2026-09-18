import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createQuestionBank } from "./actions";

export default async function QuestionBankListPage() {
  const banks = await prisma.questionBank.findMany({
    include: { questions: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">بنك الأسئلة</h1>

      <form
        action={createQuestionBank}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">اسم البنك</span>
          <input
            name="name"
            required
            placeholder="أسئلة الجبر - الوحدة الأولى"
            className="min-w-64 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">وصف (اختياري)</span>
          <input
            name="description"
            className="min-w-64 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إنشاء بنك
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {banks.map((bank) => (
          <Link
            key={bank.id}
            href={`/teacher/question-bank/${bank.id}`}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300"
          >
            <p className="font-semibold">{bank.name}</p>
            {bank.description && (
              <p className="mt-1 text-xs text-gray-500">{bank.description}</p>
            )}
            <p className="mt-2 text-xs text-gray-500">{bank.questions.length} سؤال</p>
          </Link>
        ))}
        {banks.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد بنوك أسئلة بعد.</p>
        )}
      </div>
    </div>
  );
}
