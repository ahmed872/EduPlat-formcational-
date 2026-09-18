import Link from "next/link";
import { auth } from "@/auth";

export default async function HomePage() {
  const session = await auth();

  const dashboardHref = session
    ? session.user.role === "TEACHER_ADMIN"
      ? "/teacher"
      : session.user.role === "PARENT"
        ? "/parent"
        : "/student"
    : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <h1 className="text-3xl font-bold">منصة إديوبلات التعليمية</h1>
      <p className="max-w-xl text-gray-600">
        منصة تعليمية بمحتوى مسجّل بالكامل — بدون حصص مباشرة أو بث مباشر.
        كل درس وفيديو وتجربة عملية واختبار متاح حسب جدول النشر الذي يحدده
        المعلم.
      </p>
      <div className="flex gap-4">
        {dashboardHref ? (
          <Link
            href={dashboardHref}
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
          >
            لوحة التحكم
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
            >
              تسجيل الدخول
            </Link>
            <Link
              href="/register"
              className="rounded-md border border-indigo-600 px-5 py-2.5 text-indigo-600 hover:bg-indigo-50"
            >
              إنشاء حساب
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
