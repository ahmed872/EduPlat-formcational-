import { prisma } from "@/lib/prisma";
import { toggleShortStatus, uploadShort } from "./actions";

export default async function TeacherShortsPage() {
  const [shorts, videos] = await Promise.all([
    prisma.short.findMany({
      include: { sourceVideo: { include: { lesson: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.video.findMany({
      where: { status: "PUBLISHED" },
      include: { lesson: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Shorts (فيديوهات قصيرة مجانية)</h1>
      <p className="text-sm text-gray-600">
        الشورت دائمًا مجاني للجميع. يمكن ربطه بلحظة زمنية داخل فيديو أصلي —
        عند نهاية الشورت، إذا كان الطالب مشتركًا في الدرس الأصلي سيُفتح
        الفيديو عند نفس اللحظة، وإلا سيظهر له عرض للاشتراك.
      </p>

      <form
        action={uploadShort}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">ملف الفيديو القصير</span>
          <input
            type="file"
            name="video"
            accept="video/mp4,video/webm,video/quicktime"
            required
            className="text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">العنوان</span>
          <input
            name="title"
            required
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">المدة (ثانية)</span>
          <input
            type="number"
            name="durationSeconds"
            min="1"
            required
            className="w-24 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الفيديو الأصلي (اختياري)</span>
          <select
            name="sourceVideoId"
            className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">— بدون ربط —</option>
            {videos.map((video) => (
              <option key={video.id} value={video.id}>
                {video.lesson?.title ?? video.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">اللحظة الزمنية (ثانية)</span>
          <input
            type="number"
            name="sourceTimestampSeconds"
            min="0"
            className="w-28 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          رفع الشورت
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shorts.map((short) => (
          <div key={short.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-semibold">{short.title}</p>
            <p className="mt-1 text-xs text-gray-500">
              {short.durationSeconds} ثانية
              {short.sourceVideo &&
                ` · مرتبط بـ ${short.sourceVideo.lesson?.title ?? short.sourceVideo.title} عند ${short.sourceTimestampSeconds}ث`}
            </p>
            <div className="mt-3 flex items-center justify-between">
              <span
                className={
                  short.status === "PUBLISHED"
                    ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                    : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                }
              >
                {short.status === "PUBLISHED" ? "منشور" : "مؤرشف"}
              </span>
              <form
                action={toggleShortStatus.bind(null, short.id, short.status !== "PUBLISHED")}
              >
                <button type="submit" className="text-xs text-indigo-600 hover:underline">
                  {short.status === "PUBLISHED" ? "أرشفة" : "نشر"}
                </button>
              </form>
            </div>
          </div>
        ))}
        {shorts.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد شورتس بعد.</p>
        )}
      </div>
    </div>
  );
}
