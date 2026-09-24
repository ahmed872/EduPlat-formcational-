import { prisma } from "@/lib/prisma";
import { restoreCertificateAction, revokeCertificateAction } from "./actions";

export default async function TeacherCertificatesPage() {
  const certificates = await prisma.certificate.findMany({
    include: { student: { include: { user: true } }, course: true },
    orderBy: { issuedAt: "desc" },
    take: 100,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الشهادات الصادرة</h1>
        <p className="mt-1 text-sm text-gray-600">
          تُصدر كل شهادة آليًا فور إتمام الطالب لكل دروس الكورس المنشورة —
          لا يوجد إصدار يدوي.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">الطالب</th>
              <th className="px-4 py-2">الكورس</th>
              <th className="px-4 py-2">الكود</th>
              <th className="px-4 py-2">تاريخ الإصدار</th>
              <th className="px-4 py-2">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {certificates.map((certificate) => (
              <tr key={certificate.id} data-certificate-row={certificate.certificateCode} className="border-t border-gray-100">
                <td className="px-4 py-2">{certificate.student.user.name}</td>
                <td className="px-4 py-2">{certificate.course.title}</td>
                <td className="px-4 py-2 font-mono text-xs">{certificate.certificateCode}</td>
                <td className="px-4 py-2">{certificate.issuedAt.toLocaleDateString("ar-EG")}</td>
                <td className="px-4 py-2">
                  {certificate.revokedAt ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-amber-700">ملغاة: {certificate.revokedReason}</span>
                      <form action={restoreCertificateAction.bind(null, certificate.id)}>
                        <button type="submit" className="text-xs text-indigo-600 hover:underline">
                          استعادة الشهادة
                        </button>
                      </form>
                    </div>
                  ) : (
                    <form action={revokeCertificateAction.bind(null, certificate.id)} className="flex items-center gap-1">
                      <span className="text-xs text-green-700">سارية</span>
                      <input
                        name="reason"
                        required
                        maxLength={300}
                        placeholder="سبب الإلغاء"
                        className="w-32 rounded border border-gray-300 px-1 py-0.5 text-xs"
                      />
                      <button type="submit" className="text-xs text-red-600 hover:underline">
                        إلغاء
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {certificates.length === 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-500" colSpan={5}>
                  لا توجد شهادات صادرة بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
