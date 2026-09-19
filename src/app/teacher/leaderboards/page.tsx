import { prisma } from "@/lib/prisma";
import { getLeaderboard } from "@/lib/business/leaderboard";
import type { LeaderboardPeriod } from "@prisma/client";

const PERIOD_LABELS: Record<string, string> = {
  DAILY: "اليوم",
  WEEKLY: "هذا الأسبوع",
  MONTHLY: "هذا الشهر",
};

export default async function TeacherLeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ gameId?: string; period?: string }>;
}) {
  const { gameId, period: periodParam } = await searchParams;
  const period = (periodParam ?? "DAILY") as LeaderboardPeriod;

  const games = await prisma.game.findMany({ orderBy: { id: "desc" } });
  const selectedGameId = gameId ?? games[0]?.id;

  const board = selectedGameId
    ? await getLeaderboard(prisma, { gameId: selectedGameId, period })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">لوحة الصدارة</h1>
        <p className="mt-1 text-sm text-gray-600">
          محسوبة مباشرة من محاولات اللعب الحقيقية — لا يوجد جدولة تلقائية في
          هذه البيئة، فتُعاد الحسابات في كل مرة تُفتح فيها هذه الصفحة.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">اللعبة</span>
          <select
            name="gameId"
            defaultValue={selectedGameId}
            className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الفترة</span>
          <select
            name="period"
            defaultValue={period}
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            {Object.entries(PERIOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          عرض
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">الترتيب</th>
              <th className="px-4 py-2">الطالب</th>
              <th className="px-4 py-2">النتيجة</th>
            </tr>
          </thead>
          <tbody>
            {board.map((entry) => (
              <tr key={entry.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-semibold">{entry.rank}</td>
                <td className="px-4 py-2">{entry.student.user.name}</td>
                <td className="px-4 py-2">{entry.score}</td>
              </tr>
            ))}
            {board.length === 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-500" colSpan={3}>
                  لا توجد نتائج لهذه الفترة بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
