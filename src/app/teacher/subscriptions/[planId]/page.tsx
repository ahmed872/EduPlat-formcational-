import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { addPlanItem, removePlanItem } from "../actions";

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  const [plan, courses] = await Promise.all([
    prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      include: { items: { include: { course: true } } },
    }),
    prisma.course.findMany({ where: { status: "PUBLISHED" } }),
  ]);
  if (!plan) notFound();

  const addItem = addPlanItem.bind(null, plan.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{plan.name}</h1>
        <p className="text-sm text-gray-500">
          {(plan.priceCents / 100).toFixed(2)} {plan.currency} · {plan.academicYear}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">الكورسات المشمولة بالخطة</h2>
        <p className="mb-3 text-xs text-gray-500">
          الطالب الذي يشترك في هذه الخطة يحصل على صلاحية الوصول للدروس
          الموجودة داخل هذه الكورسات <strong>وقت الاشتراك فقط</strong>. أي
          درس يُنشر لاحقًا في نفس الكورس لن يظهر تلقائيًا لمن اشترك من قبل.
        </p>
        <ul className="flex flex-col gap-2">
          {plan.items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2"
            >
              <span>{item.course?.title ?? "—"}</span>
              <form action={removePlanItem.bind(null, plan.id, item.id)}>
                <button type="submit" className="text-xs text-red-500 hover:underline">
                  إزالة
                </button>
              </form>
            </li>
          ))}
          {plan.items.length === 0 && (
            <li className="text-sm text-gray-500">لا يوجد محتوى مضاف بعد.</li>
          )}
        </ul>
      </div>

      <form
        action={addItem}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">إضافة كورس</span>
          <select
            name="courseId"
            required
            className="min-w-64 rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">اختر كورسًا</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
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
