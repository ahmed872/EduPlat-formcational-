import { prisma } from "@/lib/prisma";
import { getAuditLog } from "@/lib/business/security";

const ACTION_LABELS: Record<string, string> = {
  CONFIRM_PAYMENT: "تأكيد دفعة",
  REJECT_PAYMENT: "رفض دفعة",
  REFUND_PAYMENT: "استرجاع دفعة",
  BLOCK_USER: "حظر حساب",
  UNBLOCK_USER: "رفع حظر حساب",
};

export default async function TeacherAuditLogPage() {
  const entries = await getAuditLog(prisma);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">سجل التدقيق</h1>
        <p className="mt-1 text-sm text-gray-600">
          سجل حقيقي لكل الإجراءات الحساسة (دفعات، حظر حسابات) — لا يمكن حذف أو تعديل أي صف منه.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">التاريخ</th>
              <th className="px-4 py-2">القائم بالإجراء</th>
              <th className="px-4 py-2">الإجراء</th>
              <th className="px-4 py-2">العنصر</th>
              <th className="px-4 py-2">تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-gray-100">
                <td className="px-4 py-2 text-xs text-gray-500">
                  {entry.createdAt.toLocaleString("ar-EG")}
                </td>
                <td className="px-4 py-2">{entry.actor.name}</td>
                <td className="px-4 py-2">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {entry.entityType}#{entry.entityId.slice(0, 8)}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {entry.metadata ? JSON.stringify(entry.metadata) : "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-500" colSpan={5}>
                  لا توجد إجراءات مسجلة بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
