import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-bold">الصفحة غير موجودة</h1>
      <p className="text-sm text-gray-600">الرابط غير صحيح، أو أن المحتوى لم يعد متاحًا لك.</p>
      <Link href="/" className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
        الصفحة الرئيسية
      </Link>
    </main>
  );
}
