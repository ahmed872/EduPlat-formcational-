import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  certificateQrSvg,
  certificateVerificationUrl,
  getCertificatesForStudent,
} from "@/lib/business/certificates";

export default async function StudentCertificatesPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const h = await headers();
  const fallbackOrigin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : undefined;
  const certificates = await Promise.all(
    (await getCertificatesForStudent(prisma, studentId)).map(async (certificate) => {
      const verifyUrl = certificateVerificationUrl(certificate.certificateCode, fallbackOrigin);
      return { ...certificate, verifyUrl, qrSvg: await certificateQrSvg(verifyUrl) };
    }),
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">شهاداتي</h1>
        <p className="mt-1 text-sm text-gray-600">
          تُصدر الشهادة تلقائيًا فور إتمام كل دروس الكورس فعليًا — وليست
          شارة صورية. يمكن لأي شخص التحقق منها بمسح رمز QR.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {certificates.map((certificate) => (
          <div
            key={certificate.id}
            data-certificate={certificate.certificateCode}
            className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4"
          >
            <div>
              <p className="font-semibold">{certificate.course.title}</p>
              <p className="mt-1 text-xs text-gray-500">
                تاريخ الإصدار: {certificate.issuedAt.toLocaleDateString("ar-EG")}
              </p>
              <p className="mt-1 text-xs text-gray-500">الكود: {certificate.certificateCode}</p>
              {certificate.revokedAt && (
                <p className="mt-1 text-xs font-semibold text-amber-700">هذه الشهادة ملغاة</p>
              )}
              <div className="mt-2 flex gap-4 text-sm">
                <a href={certificate.verifyUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                  رابط التحقق العام ↗
                </a>
                <Link href={`/student/certificates/${certificate.id}`} className="text-indigo-600 hover:underline">
                  عرض وطباعة الشهادة
                </Link>
              </div>
            </div>
            {/* SVG generated locally by the qrcode library from our own URL. */}
            <div
              className="h-28 w-28 shrink-0"
              data-testid="certificate-qr"
              role="img"
              aria-label="رمز QR للتحقق من الشهادة"
              dangerouslySetInnerHTML={{ __html: certificate.qrSvg }}
            />
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
