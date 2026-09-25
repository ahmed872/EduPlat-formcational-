import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function ShortsFeedPage() {
  const shorts = await prisma.short.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">شورتس تعليمية مجانية</h1>
        <p className="mt-1 text-sm text-gray-600">
          متاحة للجميع بدون تسجيل دخول أو اشتراك.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {shorts.map((short) => (
          <Link
            key={short.id}
            href={`/shorts/${short.id}`}
            className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white"
          >
            <div className="flex aspect-[9/16] items-center justify-center bg-gray-900 text-xs text-gray-300">
              {short.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={short.thumbnailUrl}
                  alt={short.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>{Math.floor(short.durationSeconds / 60)}:{String(short.durationSeconds % 60).padStart(2, "0")}</span>
              )}
            </div>
            <p className="p-2 text-sm font-medium">{short.title}</p>
          </Link>
        ))}
        {shorts.length === 0 && (
          <p className="col-span-full text-sm text-gray-500">لا توجد شورتس منشورة بعد.</p>
        )}
      </div>
    </div>
  );
}
