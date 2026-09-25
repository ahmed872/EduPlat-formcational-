import type { CareerField } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CAREER_TRAITS,
  CAREER_TRAIT_LABELS,
  readResources,
  readRoadmap,
} from "@/lib/business/career-guidance";
import { createCareerField, deleteCareerField, updateCareerField } from "./actions";

function CareerFieldFormFields({ field }: { field?: CareerField }) {
  const roadmap = field ? readRoadmap(field.roadmap) : [];
  const resources = field ? readResources(field.resources) : [];

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">الاسم</span>
        <input
          name="name"
          required
          defaultValue={field?.name}
          placeholder="هندسة البرمجيات"
          className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">الوصف</span>
        <textarea
          name="description"
          required
          rows={2}
          defaultValue={field?.description}
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">وظائف شائعة (مفصولة بفواصل)</span>
        <input
          name="commonJobs"
          defaultValue={field?.commonJobs.join(", ")}
          placeholder="مطور واجهات, مهندس نظم"
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">مهارات مطلوبة (مفصولة بفواصل)</span>
        <input
          name="requiredSkills"
          defaultValue={field?.requiredSkills.join(", ")}
          placeholder="حل المشكلات, البرمجة"
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-gray-600">
          السمات التي يطابقها اختبار استكشاف الميول
        </legend>
        <div className="flex flex-wrap gap-3">
          {CAREER_TRAITS.map((trait) => (
            <label key={trait} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="traits"
                value={trait}
                defaultChecked={field?.traits.includes(trait)}
                className="rounded border-gray-300"
              />
              {CAREER_TRAIT_LABELS[trait]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">خارطة الطريق (خطوة في كل سطر، اختياري)</span>
        <textarea
          name="roadmap"
          rows={3}
          defaultValue={roadmap.join("\n")}
          placeholder={"تعلّم أساسيات البرمجة\nابنِ مشروعًا صغيرًا"}
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">
          مصادر تعليمية (سطر لكل مصدر: العنوان | الرابط، اختياري)
        </span>
        <textarea
          name="resources"
          rows={3}
          dir="ltr"
          defaultValue={resources.map((r) => `${r.title} | ${r.url}`).join("\n")}
          placeholder="CS50 | https://cs50.harvard.edu"
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">نصيحة لبناء ملف أعمال (اختياري)</span>
        <input
          name="portfolioAdvice"
          defaultValue={field?.portfolioAdvice ?? ""}
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">نصيحة للاستعداد للوظيفة (اختياري)</span>
        <input
          name="jobPrepAdvice"
          defaultValue={field?.jobPrepAdvice ?? ""}
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>
    </>
  );
}

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
        <CareerFieldFormFields />
        <button
          type="submit"
          className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          إضافة المجال
        </button>
      </form>

      <div className="flex flex-col gap-3">
        {fields.map((field) => (
          <div
            key={field.id}
            data-career-field={field.id}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
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
              <p className="mt-2 text-xs text-amber-700">
                لا توجد سمات محددة — لن يظهر هذا المجال أبدًا في نتائج اختبار الاستكشاف.
              </p>
            )}
            <p className="mt-2 text-xs text-gray-500">
              خارطة الطريق: {readRoadmap(field.roadmap).length} خطوة · المصادر:{" "}
              {readResources(field.resources).length}
            </p>

            <details className="mt-3 border-t border-gray-100 pt-3">
              <summary className="cursor-pointer text-sm text-indigo-600">تعديل</summary>
              <form
                action={updateCareerField.bind(null, field.id)}
                className="mt-3 flex flex-col gap-3"
              >
                <CareerFieldFormFields field={field} />
                <button
                  type="submit"
                  className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                >
                  حفظ التعديلات
                </button>
              </form>
            </details>
          </div>
        ))}
        {fields.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد مجالات مهنية بعد.</p>
        )}
      </div>
    </div>
  );
}
