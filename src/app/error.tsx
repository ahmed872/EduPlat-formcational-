"use client";

import Link from "next/link";

/**
 * Shown for any server/render error below the root layout (including a
 * refused Server Action, e.g. a duplicate checkout). In production the
 * server hides the underlying message; only a reference code is shown so
 * support can find it in the logs.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-bold">تعذّر إكمال الطلب</h1>
      <p className="text-sm text-gray-600">
        حدث خطأ أثناء تنفيذ العملية. لم يتم تنفيذ أي إجراء غير مكتمل. حاول مرة أخرى، وإن تكررت المشكلة
        تواصل مع الدعم الفني.
      </p>
      {error.digest && (
        <p className="text-xs text-gray-500">
          رقم مرجعي: <span dir="ltr">{error.digest}</span>
        </p>
      )}
      <div className="flex gap-3">
        <button type="button" onClick={() => retry()} className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
          إعادة المحاولة
        </button>
        <Link href="/" className="rounded-md border border-gray-300 px-4 py-2 text-sm">
          الصفحة الرئيسية
        </Link>
      </div>
    </main>
  );
}
