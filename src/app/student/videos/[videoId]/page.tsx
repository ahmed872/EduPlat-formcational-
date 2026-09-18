import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkVideoAccess } from "@/lib/business/video-access";
import { WatchSessionPlayer } from "./watch-session-player";

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
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
            <p>
              مشغل الفيديو الفعلي يتطلب ربط مزود تخزين فيديو خاص (مثل
              Cloudflare Stream أو Mux أو S3 + HLS موقّع الروابط). هذا الجزء
              غير مفعّل بعد في هذه البيئة — التفاصيل موجودة في SECURITY.md.
            </p>
            <p className="mt-2">
              ما يعمل فعليًا الآن: التحقق من صلاحية المشاهدة على السيرفر، بدء
              جلسة مشاهدة (Watch Session) مسجّلة، احتساب المشاهدة بعد تجاوز
              نسبة المشاهدة المطلوبة، واحتساب وقت المذاكرة الفعلي.
            </p>
          </div>
          <WatchSessionPlayer
            videoId={video.id}
            durationSeconds={video.durationSeconds ?? 600}
            viewsUsed={decision.viewsUsed}
            viewLimit={decision.viewLimit}
          />
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
