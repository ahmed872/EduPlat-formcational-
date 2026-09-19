import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canPlayGame } from "@/lib/business/games";
import type { GameQuestion } from "@/lib/business/games";
import { startPlay } from "../actions";
import { GameRunner } from "../game-runner";

export default async function PlayGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) notFound();

  const inProgress = await prisma.gameSession.findFirst({
    where: { gameId, studentId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });

  if (inProgress) {
    const config = (game.config ?? { questions: [] }) as { questions: GameQuestion[] };
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <GameRunner
          gameId={game.id}
          sessionId={inProgress.id}
          questions={config.questions}
          durationMinutes={game.durationMinutes}
          startedAt={inProgress.startedAt.toISOString()}
        />
      </div>
    );
  }

  const decision = await canPlayGame(prisma, { gameId, studentId });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-bold">{game.name}</h1>
      {decision.allowed ? (
        <form action={startPlay.bind(null, gameId)}>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
          >
            ابدأ اللعبة
          </button>
        </form>
      ) : (
        <p className="text-sm text-amber-700">
          {decision.reason === "NOT_ACTIVE" && "هذه اللعبة غير متاحة حاليًا."}
          {decision.reason === "NOT_OPEN_YET" && "لم يحن وقت فتح هذا التحدي اليوم بعد."}
          {decision.reason === "ALREADY_PLAYED_TODAY" && "لقد لعبت هذا التحدي اليوم بالفعل."}
        </p>
      )}
    </div>
  );
}
