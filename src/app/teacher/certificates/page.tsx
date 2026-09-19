import { prisma } from "@/lib/prisma";

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
            </tr>
          </thead>
          <tbody>
            {certificates.map((certificate) => (
              <tr key={certificate.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{certificate.student.user.name}</td>
                <td className="px-4 py-2">{certificate.course.title}</td>
                <td className="px-4 py-2 font-mono text-xs">{certificate.certificateCode}</td>
                <td className="px-4 py-2">{certificate.issuedAt.toLocaleDateString("ar-EG")}</td>
              </tr>
            ))}
            {certificates.length === 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-500" colSpan={4}>
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
