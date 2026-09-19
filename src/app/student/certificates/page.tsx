import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCertificatesForStudent } from "@/lib/business/certificates";

export default async function StudentCertificatesPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const certificates = await getCertificatesForStudent(prisma, studentId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">شهاداتي</h1>
        <p className="mt-1 text-sm text-gray-600">
          تُصدر الشهادة تلقائيًا فور إتمام كل دروس الكورس فعليًا — وليست
          شارة صورية.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {certificates.map((certificate) => (
          <div key={certificate.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-semibold">{certificate.course.title}</p>
            <p className="mt-1 text-xs text-gray-500">
              تاريخ الإصدار: {certificate.issuedAt.toLocaleDateString("ar-EG")}
            </p>
            <p className="mt-1 text-xs text-gray-500">الكود: {certificate.certificateCode}</p>
            <a
              href={`/certificates/verify/${certificate.certificateCode}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-indigo-600 hover:underline"
            >
              رابط التحقق العام ↗
            </a>
          </div>
        ))}
        {certificates.length === 0 && (
          <p className="text-sm text-gray-500">
            لا توجد شهادات بعد — أكمل كل دروس أي كورس للحصول على شهادتك الأولى.
          </p>
        )}
      </div>
    </div>
  );
}
