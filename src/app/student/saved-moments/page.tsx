import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default async function SavedMomentsPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const [bookmarks, notes] = await Promise.all([
    prisma.bookmark.findMany({
      where: { studentId },
      include: { video: { include: { lesson: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.studentNote.findMany({
      where: { studentId },
      include: { video: { include: { lesson: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">لحظاتي المحفوظة</h1>
        <p className="mt-1 text-sm text-gray-600">
          كل اللحظات التي حفظتها والملاحظات الخاصة بك عبر كل الفيديوهات.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">اللحظات المحفوظة</h2>
        <div className="flex flex-col gap-2">
          {bookmarks.map((bookmark) => (
            <Link
              key={bookmark.id}
              href={`/student/videos/${bookmark.videoId}?t=${bookmark.timestampSeconds}`}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-2 text-sm hover:border-indigo-300"
            >
              <span>{bookmark.video.lesson?.title ?? bookmark.video.title}</span>
              <span className="text-indigo-600">{formatTime(bookmark.timestampSeconds)}</span>
            </Link>
          ))}
          {bookmarks.length === 0 && (
            <p className="text-sm text-gray-500">لا توجد لحظات محفوظة بعد.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">ملاحظاتي</h2>
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <Link
              key={note.id}
              href={`/student/videos/${note.videoId}?t=${note.timestampSeconds}`}
              className="flex flex-col rounded-md border border-gray-200 bg-white px-4 py-2 text-sm hover:border-indigo-300"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {note.video.lesson?.title ?? note.video.title}
                </span>
                <span className="text-indigo-600">{formatTime(note.timestampSeconds)}</span>
              </div>
              <span className="text-gray-600">{note.content}</span>
            </Link>
          ))}
          {notes.length === 0 && (
            <p className="text-sm text-gray-500">لا توجد ملاحظات بعد.</p>
          )}
        </div>
      </section>
    </div>
  );
}
