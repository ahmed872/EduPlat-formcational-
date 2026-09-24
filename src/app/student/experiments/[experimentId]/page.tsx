import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getExperimentForStudent } from "@/lib/business/experiment";
import { startAttempt } from "./actions";
import { ExperimentRunner } from "./experiment-runner";

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const exists = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true } });
  if (!exists) notFound();

  let view: Awaited<ReturnType<typeof getExperimentForStudent>>;
  try {
    view = await getExperimentForStudent(prisma, { experimentId, studentId });
  } catch (error) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
        {error instanceof Error ? error.message : "هذه التجربة غير متاحة لك."}
      </div>
    );
  }

  const video = await prisma.video.findUnique({
    where: { lessonId: view.experiment.lessonId },
    select: { id: true },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        {video && (
          <Link href={`/student/videos/${video.id}`} className="text-xs text-indigo-600 hover:underline">
            ← العودة للدرس
          </Link>
        )}
        <h1 className="mt-1 text-xl font-bold">{view.experiment.title}</h1>
      </div>

      <p className="whitespace-pre-line rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        {view.publicExperiment.instructions}
      </p>

      {view.completed && (
        <div
          className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"
          data-testid="experiment-completed"
        >
          ✓ اجتزت هذه التجربة.
        </div>
      )}

      {view.openAttempt ? (
        <ExperimentRunner
          experimentId={view.experiment.id}
          attemptId={view.openAttempt.id}
          startedAt={view.openAttempt.startedAt.toISOString()}
          initialState={view.openAttempt.state}
          experiment={view.publicExperiment}
        />
      ) : (
        <form action={startAttempt.bind(null, experimentId)}>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
          >
            {view.completed ? "إعادة التجربة" : "ابدأ التجربة"}
          </button>
        </form>
      )}
    </div>
  );
}
