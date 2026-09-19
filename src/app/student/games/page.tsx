import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canPlayGame } from "@/lib/business/games";

const TYPE_LABELS: Record<string, string> = {
  MINI: "لعبة سريعة",
  DAILY_MAIN: "التحدي اليومي",
};

const REASON_LABELS: Record<string, string> = {
  NOT_ACTIVE: "غير متاحة حاليًا",
  NOT_OPEN_YET: "لم تفتح بعد اليوم",
  ALREADY_PLAYED_TODAY: "لعبتها بالفعل اليوم — عد غدًا",
};

export default async function StudentGamesPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const games = await prisma.game.findMany({ where: { active: true } });
  const decisions = await Promise.all(
    games.map((game) => canPlayGame(prisma, { gameId: game.id, studentId })),
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">الألعاب التعليمية</h1>
      <div className="flex flex-col gap-3">
        {games.map((game, i) => {
          const decision = decisions[i];
          return (
            <div key={game.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{game.name}</p>
                  <p className="text-xs text-gray-500">
                    {TYPE_LABELS[game.type] ?? game.type}
                    {game.dailyOpenTime && ` · يفتح الساعة ${game.dailyOpenTime}`}
                    {` · ${game.durationMinutes} دقيقة`}
                  </p>
                </div>
                {decision.allowed ? (
                  <Link
                    href={`/student/games/${game.id}/play`}
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                  >
                    العب الآن
                  </Link>
                ) : (
                  <span className="text-xs text-amber-700">
                    {REASON_LABELS[decision.reason] ?? decision.reason}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {games.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد ألعاب متاحة حاليًا.</p>
        )}
      </div>
    </div>
  );
}
