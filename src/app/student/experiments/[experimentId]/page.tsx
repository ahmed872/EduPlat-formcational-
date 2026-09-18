import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkVideoAccess } from "@/lib/business/video-access";
import { startAttempt } from "./actions";
import { ExperimentRunner } from "./experiment-runner";

type ExperimentConfig = {
  instructions?: string;
  steps?: string[];
  embedUrl?: string;
};

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      lesson: { include: { video: true } },
      attempts: {
        where: { studentId },
        orderBy: { startedAt: "desc" },
      },
    },
  });
  if (!experiment) notFound();

  if (experiment.lesson.video) {
    const decision = await checkVideoAccess(prisma, {
      studentId,
      videoId: experiment.lesson.video.id,
    });
    if (!decision.allowed) {
      return (
        <div className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          هذه التجربة جزء من درس غير متاح لك حاليًا.
        </div>
      );
    }
  }

  const config = experiment.config as ExperimentConfig;
  const completedAttempt = experiment.attempts.find((a) => a.completedAt !== null);
  const inProgressAttempt = experiment.attempts.find((a) => a.completedAt === null);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link
          href={`/student/videos/${experiment.lesson.video?.id ?? ""}`}
          className="text-xs text-indigo-600 hover:underline"
        >
          ← العودة للدرس
        </Link>
        <h1 className="mt-1 text-xl font-bold">{experiment.title}</h1>
      </div>

      <p className="whitespace-pre-line rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        {config.instructions}
      </p>

      {completedAttempt ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
          ✓ تم إنهاء هذه التجربة.
        </div>
      ) : inProgressAttempt ? (
        <ExperimentRunner
          experimentId={experiment.id}
          attemptId={inProgressAttempt.id}
          steps={config.steps ?? []}
          embedUrl={config.embedUrl}
        />
      ) : (
        <form action={startAttempt.bind(null, experimentId)}>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
          >
            ابدأ التجربة
          </button>
        </form>
      )}
    </div>
  );
}
