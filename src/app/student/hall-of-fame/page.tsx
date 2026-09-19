import { getApprovedHallOfFame } from "@/lib/business/leaderboard";
import { prisma } from "@/lib/prisma";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function StudentHallOfFamePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const month = monthParam ?? currentMonth();

  const entries = await getApprovedHallOfFame(prisma, month);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">قاعة الشرف</h1>
        <p className="mt-1 text-sm text-gray-600">أفضل الطلاب في الألعاب التعليمية هذا الشهر</p>
      </div>

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

      <ol className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
          >
            <span>
              #{entry.rank} — {entry.student.user.name}
              {entry.title && <span className="ms-2 text-xs text-gray-500">({entry.title})</span>}
            </span>
          </li>
        ))}
        {entries.length === 0 && (
          <p className="text-sm text-gray-500">لا يوجد طلاب معتمدون في قاعة الشرف لهذا الشهر بعد.</p>
        )}
      </ol>
    </div>
  );
}
