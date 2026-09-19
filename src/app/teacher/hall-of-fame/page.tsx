import { prisma } from "@/lib/prisma";
import { approveEntry, generateCandidates } from "./actions";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function TeacherHallOfFamePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const month = monthParam ?? currentMonth();

  const entries = await prisma.hallOfFameEntry.findMany({
    where: { month },
    include: { student: { include: { user: true } } },
    orderBy: { rank: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">قاعة الشرف</h1>
        <p className="mt-1 text-sm text-gray-600">
          يقترح النظام المرشحين من إجمالي نقاط الألعاب الحقيقية لهذا الشهر —
          لا يظهر أي طالب للعامة قبل موافقتك.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <form className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">الشهر</span>
            <input
              type="month"
              name="month"
              defaultValue={month}
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            عرض
          </button>
        </form>
        <form action={generateCandidates}>
          <input type="hidden" name="month" value={month} />
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            توليد المرشحين لهذا الشهر
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">الترتيب</th>
              <th className="px-4 py-2">الطالب</th>
              <th className="px-4 py-2">الحالة</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-semibold">{entry.rank}</td>
                <td className="px-4 py-2">{entry.student.user.name}</td>
                <td className="px-4 py-2">
                  {entry.approved ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      معتمد
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      بانتظار الاعتماد
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {!entry.approved && (
                    <form action={approveEntry.bind(null, entry.id)}>
                      <button type="submit" className="text-xs text-indigo-600 hover:underline">
                        اعتماد
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-500" colSpan={4}>
                  لا يوجد مرشحون لهذا الشهر بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
