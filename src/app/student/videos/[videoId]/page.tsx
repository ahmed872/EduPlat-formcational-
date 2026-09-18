import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkVideoAccess } from "@/lib/business/video-access";
import { VideoPlayer } from "./video-player";

export default async function WatchVideoPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = await params;
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: { chapters: { orderBy: { order: "asc" } }, lesson: true },
  });
  if (!video) notFound();

  const decision = await checkVideoAccess(prisma, { studentId, videoId });

  const lastSession = decision.allowed
    ? await prisma.watchSession.findFirst({
        where: { studentId, videoId },
        orderBy: { startedAt: "desc" },
      })
    : null;

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
            resumeFromSeconds={lastSession?.watchedSeconds ?? 0}
            watermarkLabel={`${session!.user.name} · ${session!.user.id.slice(0, 8)}`}
          />
          <p className="text-xs text-gray-500">
            البث يتم عبر رابط موقّع (signed URL) محدود الصلاحية ويُتحقق من
            صلاحية المشاهدة على السيرفر مع كل طلب — راجع SECURITY.md لتفاصيل
            الحماية وما هو مخطط لاحقًا (HLS/DRM عند توفر مزود بث حقيقي).
          </p>
          {video.chapters.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-2 font-semibold">فصول الفيديو</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {video.chapters.map((chapter) => (
                  <li key={chapter.id} className="flex justify-between">
                    <span>{chapter.title}</span>
                    <span className="text-gray-500">
                      {Math.floor(chapter.timestampSeconds / 60)}:
                      {String(chapter.timestampSeconds % 60).padStart(2, "0")}
                    </span>
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
