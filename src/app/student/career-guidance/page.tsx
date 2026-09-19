import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  CAREER_QUIZ_QUESTIONS,
  getCareerExplorationHistory,
  listCareerFields,
} from "@/lib/business/career-guidance";
import { submitQuiz } from "./actions";

export default async function StudentCareerGuidancePage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const [history, allFields] = await Promise.all([
    getCareerExplorationHistory(prisma, studentId),
    listCareerFields(prisma),
  ]);

  const latest = history[0];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">التوجيه المهني</h1>
        <p className="mt-1 text-sm text-gray-600">
          اختبار قصير لاستكشاف ميولك يقترح مجالات مهنية حقيقية بناءً فعليًا
          على إجاباتك.
        </p>
      </div>

      {latest && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
          <p className="font-semibold">
            آخر نتيجة ({latest.result.takenAt.toLocaleDateString("ar-EG")})
          </p>
          {latest.suggestedFields.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {latest.suggestedFields.map((field) => (
                <li key={field.id} className="text-sm">🎯 {field.name}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-600">
              لم يُطابَق أي مجال بعد — قد لا تحتوي المجالات الحالية على سمات
              مطابقة لإجاباتك.
            </p>
          )}
        </div>
      )}

      <form
        action={submitQuiz}
        className="flex flex-col gap-5 rounded-lg border border-gray-200 bg-white p-4"
      >
        <h2 className="font-semibold">{latest ? "إعادة الاختبار" : "ابدأ الاختبار"}</h2>
        {CAREER_QUIZ_QUESTIONS.map((question, i) => (
          <fieldset key={question.id} className="flex flex-col gap-2">
            <legend className="text-sm font-medium">
              {i + 1}. {question.prompt}
            </legend>
            {question.options.map((option) => (
              <label key={option.label} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={question.id}
                  value={option.trait}
                  required
                  className="border-gray-300"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ))}
        <button
          type="submit"
          className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          إرسال الإجابات
        </button>
      </form>

      {history.length > 1 && (
        <div>
          <h2 className="mb-2 text-lg font-bold">محاولات سابقة</h2>
          <div className="flex flex-col gap-2">
            {history.slice(1).map(({ result, suggestedFields }) => (
              <div key={result.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                <p className="text-gray-500">{result.takenAt.toLocaleDateString("ar-EG")}</p>
                <p>{suggestedFields.map((f) => f.name).join("، ") || "لا توجد مطابقات"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-bold">تصفح كل المجالات المهنية</h2>
        <div className="flex flex-col gap-3">
          {allFields.map((field) => (
            <details key={field.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <summary className="cursor-pointer font-semibold">{field.name}</summary>
              <p className="mt-2 text-sm text-gray-600">{field.description}</p>
              {field.commonJobs.length > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  وظائف شائعة: {field.commonJobs.join("، ")}
                </p>
              )}
              {field.requiredSkills.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  مهارات مطلوبة: {field.requiredSkills.join("، ")}
                </p>
              )}
              {field.portfolioAdvice && (
                <p className="mt-2 text-xs text-gray-700">📁 {field.portfolioAdvice}</p>
              )}
              {field.jobPrepAdvice && (
                <p className="mt-1 text-xs text-gray-700">💼 {field.jobPrepAdvice}</p>
              )}
            </details>
          ))}
          {allFields.length === 0 && (
            <p className="text-sm text-gray-500">لا توجد مجالات مهنية متاحة بعد.</p>
          )}
        </div>
      </div>
    </div>
  );
}
