import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { certificateQrSvg, certificateVerificationUrl } from "@/lib/business/certificates";
import { PrintButton } from "@/components/print-button";

/** Printable certificate carrying its verification QR code (owner only). */
export default async function CertificatePrintPage({
  params,
}: {
  params: Promise<{ certificateId: string }>;
}) {
  const { certificateId } = await params;
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  // Same 404 for "missing" and "someone else's".
  const certificate = await prisma.certificate.findFirst({
    where: { id: certificateId, studentId },
    include: { course: true, student: { include: { user: true } } },
  });
  if (!certificate) notFound();

  const h = await headers();
  const fallbackOrigin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : undefined;
  const verifyUrl = certificateVerificationUrl(certificate.certificateCode, fallbackOrigin);
  const qrSvg = await certificateQrSvg(verifyUrl);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      {certificate.revokedAt && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          هذه الشهادة ملغاة — صفحة التحقق العامة ستظهرها كشهادة غير سارية.
        </p>
      )}
      <div className="flex flex-col items-center gap-4 rounded-xl border-4 border-double border-indigo-300 bg-white p-10 text-center">
        <p className="text-sm tracking-widest text-indigo-500">EduPlat</p>
        <h1 className="text-3xl font-bold">شهادة إتمام</h1>
        <p className="text-gray-600">تشهد المنصة بأن الطالب</p>
        <p className="text-2xl font-bold text-indigo-800">{certificate.student.user.name}</p>
        <p className="text-gray-600">قد أتم بنجاح جميع دروس كورس</p>
        <p className="text-xl font-semibold">{certificate.course.title}</p>
        <p className="text-sm text-gray-500">بتاريخ {certificate.issuedAt.toLocaleDateString("ar-EG")}</p>
        <div className="mt-4 flex items-center gap-4">
          <div
            className="h-32 w-32"
            data-testid="certificate-qr"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="text-right text-xs text-gray-500">
            <p>امسح الرمز للتحقق من صحة الشهادة</p>
            <p className="mt-1 font-mono" dir="ltr">
              {certificate.certificateCode}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
