import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getReferralStats } from "@/lib/business/referral";

export default async function StudentReferralPage() {
  const session = await auth();
  const studentId = session!.user.studentProfileId!;

  const { referralCode, rewards } = await getReferralStats(prisma, studentId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">دعوة الأصدقاء</h1>
        <p className="mt-1 text-sm text-gray-600">
          شارك كودك مع صديق — بمجرد أن يشترك فعليًا (بعد التسجيل بكودك)،
          يُمدَّد اشتراكك الحالي أيامًا إضافية تلقائيًا.
        </p>
      </div>

      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-center">
        <p className="text-sm text-gray-600">كودك الخاص</p>
        <p className="mt-1 text-2xl font-bold tracking-widest text-indigo-700">{referralCode}</p>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">من دعوتهم ({rewards.length})</h2>
        <div className="flex flex-col gap-2">
          {rewards.map((reward) => (
            <div
              key={reward.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 text-sm"
            >
              <span>{reward.referred.user.name}</span>
              {reward.appliedAt ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                  تم منح {reward.rewardValue} يوم إضافي
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                  بانتظار اشتراك صديقك
                </span>
              )}
            </div>
          ))}
          {rewards.length === 0 && (
            <p className="text-sm text-gray-500">
              لم تدعُ أي صديق بعد — شارك كودك وسيظهر هنا فور تسجيله.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
