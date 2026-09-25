"use client";

/** Last-resort boundary (errors in the root layout itself). Renders its own document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "Arial, Helvetica, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <title>خطأ — إديوبلات</title>
        <h1>تعذّر تحميل المنصة</h1>
        <p>حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.</p>
        {error.digest && <p style={{ fontSize: 12, color: "#888" }}>رقم مرجعي: <span dir="ltr">{error.digest}</span></p>}
        <button type="button" onClick={() => retry()}>إعادة المحاولة</button>
      </body>
    </html>
  );
}
