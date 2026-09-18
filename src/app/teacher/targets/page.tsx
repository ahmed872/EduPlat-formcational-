import { prisma } from "@/lib/prisma";
import { setDefaultTarget } from "./actions";
import type { TargetPeriod } from "@prisma/client";

const PERIODS: { period: TargetPeriod; label: string }[] = [
  { period: "DAILY", label: "الهدف اليومي الافتراضي" },
  { period: "WEEKLY", label: "الهدف الأسبوعي الافتراضي" },
  { period: "MONTHLY", label: "الهدف الشهري الافتراضي" },
];

export default async function TeacherTargetsPage() {
  const defaults = await prisma.target.findMany({ where: { studentId: null } });
  const byPeriod = new Map(defaults.map((t) => [t.period, t]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">أهداف المذاكرة الافتراضية</h1>
        <p className="mt-1 text-sm text-gray-600">
          تطبَّق هذه الأهداف على كل الطلاب الذين ليس لديهم هدف مخصص. تُحسب من
          وقت المذاكرة الفعلي (وقت مشاهدة نشط فقط) وليس مجرد فتح الموقع.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PERIODS.map(({ period, label }) => {
          const current = byPeriod.get(period);
          return (
            <form
              key={period}
              action={setDefaultTarget.bind(null, period)}
              className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4"
            >
              <span className="text-sm font-medium">{label}</span>
              <input
                type="number"
                name="targetMinutes"
                min="1"
                defaultValue={current?.targetMinutes}
                required
                className="rounded-md border border-gray-300 px-3 py-2"
                placeholder="بالدقائق"
              />
              <button
                type="submit"
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
              >
                حفظ
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
