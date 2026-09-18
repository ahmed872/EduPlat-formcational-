import { prisma } from "@/lib/prisma";
import { createPromoCode, togglePromoActive } from "./actions";

const TYPE_LABELS: Record<string, string> = {
  PERCENT_DISCOUNT: "خصم نسبة مئوية",
  FIXED_DISCOUNT: "خصم مبلغ ثابت",
  FREE_100: "مجاني 100%",
  FREE_LESSON: "درس مجاني",
  FREE_PACKAGE: "باقة محتوى مجانية",
  FREE_PERIOD: "فترة مجانية",
};

export default async function PromoCodesPage() {
  const [promoCodes, courses] = await Promise.all([
    prisma.promoCode.findMany({
      include: {
        redemptions: true,
        applicableContent: { include: { course: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.course.findMany({ where: { status: "PUBLISHED" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">أكواد الخصم والعروض</h1>

      <form
        action={createPromoCode}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الكود</span>
          <input
            name="code"
            required
            placeholder="WELCOME10"
            className="rounded-md border border-gray-300 px-3 py-2 uppercase"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">النوع</span>
          <select name="type" required className="rounded-md border border-gray-300 px-3 py-2">
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">القيمة (نسبة % أو قرش)</span>
          <input name="value" type="number" step="0.01" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">حد الاستخدام</span>
          <input name="usageLimit" type="number" min="1" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">تاريخ الانتهاء</span>
          <input name="expiresAt" type="date" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الكورس المرتبط (للأنواع المجانية)</span>
          <select name="courseId" className="rounded-md border border-gray-300 px-3 py-2">
            <option value="">— بدون —</option>
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
          إنشاء كود
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">الكود</th>
              <th className="px-4 py-2">النوع</th>
              <th className="px-4 py-2">الاستخدام</th>
              <th className="px-4 py-2">الانتهاء</th>
              <th className="px-4 py-2">الحالة</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {promoCodes.map((promo) => (
              <tr key={promo.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-mono">{promo.code}</td>
                <td className="px-4 py-2">{TYPE_LABELS[promo.type] ?? promo.type}</td>
                <td className="px-4 py-2">
                  {promo.redemptions.length}
                  {promo.usageLimit ? ` / ${promo.usageLimit}` : ""}
                </td>
                <td className="px-4 py-2">
                  {promo.expiresAt ? new Date(promo.expiresAt).toLocaleDateString("ar-EG") : "—"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={
                      promo.active
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                        : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    }
                  >
                    {promo.active ? "مفعّل" : "متوقف"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <form action={togglePromoActive.bind(null, promo.id, !promo.active)}>
                    <button type="submit" className="text-xs text-indigo-600 hover:underline">
                      {promo.active ? "إيقاف" : "تفعيل"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {promoCodes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  لا توجد أكواد بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
