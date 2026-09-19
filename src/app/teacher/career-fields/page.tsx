import { prisma } from "@/lib/prisma";
import { CAREER_TRAITS, CAREER_TRAIT_LABELS } from "@/lib/business/career-guidance";
import { createCareerField, deleteCareerField } from "./actions";

export default async function TeacherCareerFieldsPage() {
  const fields = await prisma.careerField.findMany({ orderBy: { order: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">مجالات التوجيه المهني</h1>
        <p className="mt-1 text-sm text-gray-600">
          كل مجال يُطابَق آليًا مع اختبار استكشاف الميول عبر السمات
          (Traits) المحددة له — اختر السمات التي تعبّر فعليًا عن هذا
          المجال حتى تكون نتائج الاختبار حقيقية وذات معنى.
        </p>
      </div>

      <form
        action={createCareerField}
        className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <h2 className="font-semibold">إضافة مجال جديد</h2>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">الاسم</span>
            <input
              name="name"
              required
              placeholder="هندسة البرمجيات"
              className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الوصف</span>
          <textarea
            name="description"
            required
            rows={2}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">وظائف شائعة (مفصولة بفواصل)</span>
          <input name="commonJobs" placeholder="مطور واجهات, مهندس نظم" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">مهارات مطلوبة (مفصولة بفواصل)</span>
          <input name="requiredSkills" placeholder="حل المشكلات, البرمجة" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-gray-600">
            السمات التي يطابقها اختبار استكشاف الميول
          </legend>
          <div className="flex flex-wrap gap-3">
            {CAREER_TRAITS.map((trait) => (
              <label key={trait} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="traits" value={trait} className="rounded border-gray-300" />
                {CAREER_TRAIT_LABELS[trait]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">نصيحة لبناء ملف أعمال (اختياري)</span>
          <input name="portfolioAdvice" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">نصيحة للاستعداد للوظيفة (اختياري)</span>
          <input name="jobPrepAdvice" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>

        <button
          type="submit"
          className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          إضافة المجال
        </button>
      </form>

      <div className="flex flex-col gap-3">
        {fields.map((field) => (
          <div key={field.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{field.name}</p>
                <p className="mt-1 text-sm text-gray-600">{field.description}</p>
              </div>
              <form action={deleteCareerField.bind(null, field.id)}>
                <button type="submit" className="text-xs text-red-600 hover:underline">
                  حذف
                </button>
              </form>
            </div>
            {field.commonJobs.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">وظائف: {field.commonJobs.join("، ")}</p>
            )}
            {field.traits.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {field.traits.map((trait) => (
                  <span key={trait} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                    {CAREER_TRAIT_LABELS[trait as keyof typeof CAREER_TRAIT_LABELS] ?? trait}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-amber-600">
                لا توجد سمات محددة — لن يظهر هذا المجال أبدًا في نتائج اختبار الاستكشاف.
              </p>
            )}
          </div>
        ))}
        {fields.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد مجالات مهنية بعد.</p>
        )}
      </div>
    </div>
  );
}
