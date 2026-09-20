import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { searchForTeacher } from "@/lib/business/search";

const TYPE_LABELS: Record<string, string> = {
  COURSE: "كورس",
  LESSON: "درس",
  SHORT: "Short",
  PRODUCT: "منتج",
  CAREER_FIELD: "مجال مهني",
  QUESTION_BANK: "بنك أسئلة",
};

export default async function TeacherSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // The teacher layout already gates this whole route tree — this check is
  // defense-in-depth. It matters more here than on the student search page:
  // teacher search surfaces DRAFT/unpublished content, so this route must
  // never rely on a single point of protection.
  const session = await auth();
  if (!session?.user || session.user.role !== "TEACHER_ADMIN") {
    redirect("/login");
  }

  const { q } = await searchParams;
  const query = q ?? "";
  const results = query ? await searchForTeacher(prisma, query) : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">البحث</h1>
        <p className="mt-1 text-sm text-gray-600">
          يبحث في كل الكورسات والدروس (منشورة وغير منشورة) وShorts والمنتجات والمجالات المهنية وبنوك الأسئلة.
        </p>
      </div>

      <form className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="ابحث..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2"
        />
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
          بحث
        </button>
      </form>

      {query && (
        <div className="flex flex-col gap-2">
          {results.map((result) => (
            <Link
              key={`${result.type}-${result.id}`}
              href={result.href ?? "#"}
              className="rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{result.title}</p>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {TYPE_LABELS[result.type]}
                </span>
              </div>
              {result.subtitle && <p className="mt-1 text-xs text-gray-500">{result.subtitle}</p>}
            </Link>
          ))}
          {results.length === 0 && (
            <p className="text-sm text-gray-500">لا توجد نتائج مطابقة لـ &quot;{query}&quot;.</p>
          )}
        </div>
      )}
    </div>
  );
}
