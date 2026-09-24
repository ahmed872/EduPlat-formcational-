import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PUBLISHED_LESSON_WHERE } from "@/lib/business/content-visibility";
import { checkVideoAccess } from "@/lib/business/video-access";
import { canAccessLesson } from "@/lib/business/quiz";
import { allRequiredExperimentsCompleted, getExperimentsWithStatus } from "@/lib/business/experiment";
import { VideoPlayer } from "./video-player";

export default async function WatchVideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { videoId } = await params;
  const { t } = await searchParams;
  const startAtSeconds = t ? Number(t) : null;
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: {
      chapters: { orderBy: { order: "asc" } },
      lesson: {
        include: {
          nextLessons: {
            where: PUBLISHED_LESSON_WHERE,
            include: { video: true },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });
  if (!video) notFound();

  // Sequential unlocking (requiredPreviousLessonId) had a real business-logic
  // implementation and tests (canAccessLesson) since Foundation, but was
  // never actually called from a route — this closes that gap.
  // Visibility/entitlement first, so an unpublished lesson never reveals
  // anything about itself (not even its prerequisite state).
  const videoDecision = await checkVideoAccess(prisma, { studentId, videoId });
  const lessonAccess =
    videoDecision.allowed && video.lesson
      ? await canAccessLesson(prisma, { studentId, lessonId: video.lesson.id })
      : { allowed: true as const };

  const decision = !videoDecision.allowed
    ? videoDecision
    : lessonAccess.allowed
      ? videoDecision
      : ({ allowed: false, reason: "PREVIOUS_LESSON_NOT_COMPLETED" } as const);

  const [lastSession, notes, bookmarks, experimentStatuses, lessonQuiz] = decision.allowed
    ? await Promise.all([
        prisma.watchSession.findFirst({
          where: { studentId, videoId },
          orderBy: { startedAt: "desc" },
        }),
        prisma.studentNote.findMany({
          where: { studentId, videoId },
          orderBy: { timestampSeconds: "asc" },
        }),
        prisma.bookmark.findMany({
          where: { studentId, videoId },
          orderBy: { timestampSeconds: "asc" },
        }),
        video.lesson
          ? getExperimentsWithStatus(prisma, { lessonId: video.lesson.id, studentId })
          : Promise.resolve([]),
        video.lesson
          ? prisma.quiz.findFirst({
              where: { lessonId: video.lesson.id, examType: "LESSON_QUIZ" },
            })
          : Promise.resolve(null),
      ])
    : [null, [], [], [], null];

  const requiredExperimentsDone = video.lesson
    ? await allRequiredExperimentsCompleted(prisma, {
        studentId,
        lessonId: video.lesson.id,
      })
    : true;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-bold">
        {!decision.allowed && decision.reason === "CONTENT_UNAVAILABLE" ? "محتوى غير متاح" : video.title}
      </h1>

      {!decision.allowed ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          {decision.reason === "NOT_ENTITLED" && (
            <p>هذا الفيديو غير متاح ضمن اشتراكك الحالي.</p>
          )}
          {decision.reason === "VIEW_LIMIT_REACHED" && (
            <p>
              لقد استنفدت عدد مرات المشاهدة المسموح بها لهذا الفيديو (
              {decision.viewLimit} مرات).
            </p>
          )}
          {decision.reason === "VIDEO_NOT_FOUND" && <p>الفيديو غير موجود.</p>}
          {decision.reason === "CONTENT_UNAVAILABLE" && <p>هذا المحتوى غير متاح حاليًا.</p>}
          {decision.reason === "PREVIOUS_LESSON_NOT_COMPLETED" && (
            <p>يجب إكمال الدرس السابق واجتياز اختباره أولًا للوصول لهذا الدرس.</p>
          )}
        </div>
      ) : (
        <>
          <VideoPlayer
            videoId={video.id}
            durationSeconds={video.durationSeconds ?? 0}
            viewsUsed={decision.viewsUsed}
            viewLimit={decision.viewLimit}
            resumeFromSeconds={
              startAtSeconds !== null && !Number.isNaN(startAtSeconds)
                ? startAtSeconds
                : (lastSession?.watchedSeconds ?? 0)
            }
            watermarkLabel={`${session!.user.name} · ${session!.user.id.slice(0, 8)}`}
            chapters={video.chapters}
            initialNotes={notes.map((n) => ({
              id: n.id,
              timestampSeconds: n.timestampSeconds,
              label: n.content,
            }))}
            initialBookmarks={bookmarks.map((b) => ({
              id: b.id,
              timestampSeconds: b.timestampSeconds,
              label: b.label ?? "",
            }))}
          />
          <p className="text-xs text-gray-500">
            البث يتم عبر رابط موقّع (signed URL) محدود الصلاحية ويُتحقق من
            صلاحية المشاهدة على السيرفر مع كل طلب — راجع SECURITY.md لتفاصيل
            الحماية وما هو مخطط لاحقًا (HLS/DRM عند توفر مزود بث حقيقي).
          </p>

          {experimentStatuses.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-2 font-semibold">التجارب التفاعلية</h2>
              <ul className="flex flex-col gap-2">
                {experimentStatuses.map(({ experiment, completed }) => (
                  <li key={experiment.id} className="flex items-center justify-between text-sm">
                    <span>
                      {experiment.title}{" "}
                      {experiment.isRequired && (
                        <span className="text-xs text-amber-600">(إلزامية)</span>
                      )}
                    </span>
                    {completed ? (
                      <span className="text-xs text-green-700">✓ منتهية</span>
                    ) : (
                      <Link
                        href={`/student/experiments/${experiment.id}`}
                        className="rounded-md bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
                      >
                        ابدأ التجربة
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lessonQuiz && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-2 font-semibold">اختبار الدرس</h2>
              {requiredExperimentsDone ? (
                <Link
                  href={`/student/exams/${lessonQuiz.id}`}
                  className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                >
                  الذهاب إلى الاختبار
                </Link>
              ) : (
                <p className="text-sm text-amber-700">
                  أكمل التجارب الإلزامية أعلاه أولًا لفتح اختبار الدرس.
                </p>
              )}
            </div>
          )}

          {video.lesson && video.lesson.nextLessons.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-2 font-semibold">الدرس التالي</h2>
              <ul className="flex flex-col gap-2">
                {video.lesson.nextLessons.map((next) => (
                  <li key={next.id} className="flex items-center justify-between text-sm">
                    <span>{next.title}</span>
                    {next.video && next.video.status === "PUBLISHED" ? (
                      <Link
                        href={`/student/videos/${next.video.id}`}
                        className="rounded-md bg-gray-800 px-3 py-1 text-xs text-white hover:bg-gray-900"
                      >
                        الانتقال إليه
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">لا يوجد فيديو بعد</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
