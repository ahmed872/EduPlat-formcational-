import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { verifyCertificate } from "@/lib/business/certificates";

export const metadata: Metadata = {
  title: "التحقق من الشهادة",
  robots: { index: false, follow: false },
};

/**
 * Public — no login. Looks up only the exact code in the URL (the same code
 * the certificate's QR encodes); a malformed code never reaches the database.
 */
export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const result = await verifyCertificate(prisma, code);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-center text-2xl font-bold">التحقق من الشهادة</h1>
      {result.status === "VALID" && (
        <div data-verification="VALID" className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-lg font-semibold text-green-800">✅ شهادة صحيحة</p>
          <p className="mt-3 text-sm text-gray-700">
            تم إصدار هذه الشهادة للطالب <strong>{result.studentName}</strong>
          </p>
          <p className="mt-1 text-sm text-gray-700">
            عن إتمام كورس: <strong>{result.courseTitle}</strong>
          </p>
          <p className="mt-3 text-xs text-gray-500">تاريخ الإصدار: {result.issuedAt.toLocaleDateString("ar-EG")}</p>
          <p className="mt-1 text-xs text-gray-400">كود الشهادة: {result.code}</p>
        </div>
      )}
      {result.status === "REVOKED" && (
        <div data-verification="REVOKED" className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-center">
          <p className="text-lg font-semibold text-amber-800">⚠️ هذه الشهادة ملغاة</p>
          <p className="mt-3 text-sm text-gray-700">
            صدرت هذه الشهادة للطالب <strong>{result.studentName}</strong> عن كورس{" "}
            <strong>{result.courseTitle}</strong>، لكنها أُلغيت ولم تعد سارية.
          </p>
          <p className="mt-3 text-xs text-gray-500">
            تاريخ الإلغاء: {result.revokedAt!.toLocaleDateString("ar-EG")}
          </p>
          <p className="mt-1 text-xs text-gray-400">كود الشهادة: {result.code}</p>
        </div>
      )}
      {(result.status === "NOT_FOUND" || result.status === "INVALID") && (
        <div data-verification={result.status} className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-lg font-semibold text-red-800">❌ لم يتم العثور على شهادة بهذا الكود</p>
          <p className="mt-2 text-sm text-gray-600">
            {result.status === "INVALID"
              ? "صيغة الكود غير صحيحة — الكود يبدأ بـ CERT- ويتبعه 10 أحرف."
              : "تأكد من كتابة الكود بشكل صحيح أو امسح رمز QR الموجود على الشهادة."}
          </p>
        </div>
      )}
    </main>
  );
}
