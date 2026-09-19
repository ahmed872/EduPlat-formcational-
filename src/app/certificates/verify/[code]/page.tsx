import { prisma } from "@/lib/prisma";
import { getCertificateByCode } from "@/lib/business/certificates";

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const certificate = await getCertificateByCode(prisma, code);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-center text-2xl font-bold">التحقق من الشهادة</h1>
      {certificate ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-lg font-semibold text-green-800">✅ شهادة صحيحة</p>
          <p className="mt-3 text-sm text-gray-700">
            تم إصدار هذه الشهادة للطالب <strong>{certificate.student.user.name}</strong>
          </p>
          <p className="mt-1 text-sm text-gray-700">
            عن إتمام كورس: <strong>{certificate.course.title}</strong>
          </p>
          <p className="mt-3 text-xs text-gray-500">
            تاريخ الإصدار: {certificate.issuedAt.toLocaleDateString("ar-EG")}
          </p>
          <p className="mt-1 text-xs text-gray-400">كود الشهادة: {certificate.certificateCode}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-lg font-semibold text-red-800">❌ لم يتم العثور على شهادة بهذا الكود</p>
          <p className="mt-2 text-sm text-gray-600">تأكد من كتابة الكود بشكل صحيح.</p>
        </div>
      )}
    </main>
  );
}
