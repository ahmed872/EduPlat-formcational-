import { prisma } from "@/lib/prisma";
import { block, unblock } from "./actions";
import { ResetLinkButton } from "./reset-link-button";

const ROLE_LABELS: Record<string, string> = {
  STUDENT: "طالب",
  PARENT: "ولي أمر",
};

export default async function TeacherAccountsPage() {
  const users = await prisma.user.findMany({
    where: { role: { in: ["STUDENT", "PARENT"] } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">إدارة الحسابات</h1>
        <p className="mt-1 text-sm text-gray-600">
          حظر حساب يمنعه فعليًا من تسجيل الدخول فورًا — وليس مجرد علامة عرض.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">الاسم</th>
              <th className="px-4 py-2">البريد الإلكتروني</th>
              <th className="px-4 py-2">النوع</th>
              <th className="px-4 py-2">الحالة</th>
              <th className="px-4 py-2">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{user.name}</td>
                <td className="px-4 py-2">{user.email}</td>
                <td className="px-4 py-2">{ROLE_LABELS[user.role]}</td>
                <td className="px-4 py-2">
                  {user.status === "BLOCKED" ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      محظور{user.blockedReason ? `: ${user.blockedReason}` : ""}
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      نشط
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {user.status === "BLOCKED" ? (
                    <form action={unblock.bind(null, user.id)}>
                      <button type="submit" className="text-xs text-indigo-600 hover:underline">
                        رفع الحظر
                      </button>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <form action={block.bind(null, user.id)} className="flex items-center gap-2">
                        <input
                          name="reason"
                          placeholder="سبب الحظر"
                          required
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="text-xs text-red-600 hover:underline">
                          حظر
                        </button>
                      </form>
                      <ResetLinkButton userId={user.id} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-500" colSpan={5}>
                  لا توجد حسابات بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
