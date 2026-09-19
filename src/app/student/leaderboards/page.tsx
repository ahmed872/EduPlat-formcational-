import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getLeaderboard } from "@/lib/business/leaderboard";
import type { LeaderboardPeriod } from "@prisma/client";

const PERIOD_LABELS: Record<string, string> = {
  DAILY: "اليوم",
  WEEKLY: "هذا الأسبوع",
  MONTHLY: "هذا الشهر",
};

export default async function StudentLeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ gameId?: string; period?: string }>;
}) {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;
  const { gameId, period: periodParam } = await searchParams;
  const period = (periodParam ?? "DAILY") as LeaderboardPeriod;

  const games = await prisma.game.findMany({ where: { active: true }, orderBy: { id: "desc" } });
  const selectedGameId = gameId ?? games[0]?.id;

  const board = selectedGameId
    ? await getLeaderboard(prisma, { gameId: selectedGameId, period })
    : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold">لوحة الصدارة</h1>

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

      <ol className="flex flex-col gap-2">
        {board.map((entry) => (
          <li
            key={entry.id}
            className={
              entry.studentId === studentId
                ? "flex items-center justify-between rounded-lg border border-indigo-300 bg-indigo-50 p-3"
                : "flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
            }
          >
            <span>
              #{entry.rank} — {entry.student.user.name}
              {entry.studentId === studentId && " (أنت)"}
            </span>
            <span className="font-semibold">{entry.score}</span>
          </li>
        ))}
        {board.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد نتائج لهذه الفترة بعد.</p>
        )}
      </ol>
    </div>
  );
}
