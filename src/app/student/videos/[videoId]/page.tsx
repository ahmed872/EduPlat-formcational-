import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkVideoAccess } from "@/lib/business/video-access";
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
    include: { chapters: { orderBy: { order: "asc" } }, lesson: true },
  });
  if (!video) notFound();

  const decision = await checkVideoAccess(prisma, { studentId, videoId });

  const [lastSession, notes, bookmarks] = decision.allowed
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
      ])
    : [null, [], []];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-bold">{video.title}</h1>

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
        </>
      )}
    </div>
  );
}
