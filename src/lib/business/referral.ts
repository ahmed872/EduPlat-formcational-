import type { PrismaClient } from "@prisma/client";
import { getPlatformSetting, PLATFORM_SETTING_KEYS } from "@/lib/platform-settings";
import { notify } from "@/lib/business/notifications";

/**
 * Records a pending reward at registration time when a valid referral
 * code is supplied. An unknown code or a student "referring themselves"
 * (impossible in practice since the referred profile doesn't exist yet,
 * but guarded anyway) is silently ignored — never blocks registration,
 * same graceful-degradation stance as an invalid promo code at checkout.
 * The reward itself is not applied yet: see applyPendingReferralReward().
 */
export async function createPendingReferralReward(
  prisma: PrismaClient,
  params: { referralCode: string; referredStudentId: string },
) {
  const referrer = await prisma.studentProfile.findUnique({
    where: { referralCode: params.referralCode },
  });
  if (!referrer || referrer.id === params.referredStudentId) {
    return null;
  }

  const rewardDays = await getPlatformSetting<number>(
    PLATFORM_SETTING_KEYS.REFERRAL_REWARD_DAYS,
  );

  return prisma.referralReward.create({
    data: {
      referrerStudentId: referrer.id,
      referredStudentId: params.referredStudentId,
      rewardType: "SUBSCRIPTION_EXTENSION_DAYS",
      rewardValue: rewardDays,
    },
  });
}

/**
 * Applied the moment the REFERRED student's first subscription actually
 * succeeds — a genuine signup-to-paying-customer conversion, not just an
 * account creation (trivially fakeable at scale). Extends the referrer's
 * most recent subscription's expiry by the configured number of days.
 *
 * Known, honest gap: a referrer who has never subscribed at all has no
 * Subscription row to extend, so the reward is left unapplied rather than
 * fabricating an entitlement/subscription out of thin air — it stays
 * pending (retried on the referred student's next successful payment, if
 * any) rather than being silently dropped.
 */
export async function applyPendingReferralReward(
  prisma: PrismaClient,
  referredStudentId: string,
) {
  const pending = await prisma.referralReward.findUnique({
    where: { referredStudentId },
  });
  if (!pending || pending.appliedAt) return null;
  if (pending.expiresAt && pending.expiresAt < new Date()) return null;

  const referrerSubscription = await prisma.subscription.findFirst({
    where: { studentId: pending.referrerStudentId },
    orderBy: { expiresAt: "desc" },
  });
  if (!referrerSubscription) return null;

  const extendedExpiry = new Date(referrerSubscription.expiresAt);
  extendedExpiry.setDate(extendedExpiry.getDate() + pending.rewardValue);

  const updatedReward = await prisma.$transaction(async (tx) => {
    // The `pending.appliedAt` check above is a plain read — two concurrent
    // calls for the same referred student (e.g. two of their subscriptions
    // becoming active around the same time) could both pass it before
    // either write lands, extending the referrer's subscription twice for
    // one conversion. This conditional update (`WHERE appliedAt IS NULL`)
    // makes the check and the write atomic.
    const claimed = await tx.referralReward.updateMany({
      where: { id: pending.id, appliedAt: null },
      data: { appliedAt: new Date() },
    });
    if (claimed.count === 0) return null;

    await tx.subscription.update({
      where: { id: referrerSubscription.id },
      data: { expiresAt: extendedExpiry, status: "ACTIVE" },
    });
    return tx.referralReward.findUniqueOrThrow({ where: { id: pending.id } });
  });
  if (!updatedReward) return null;

  const referrer = await prisma.studentProfile.findUnique({
    where: { id: pending.referrerStudentId },
    select: { userId: true },
  });
  if (referrer) {
    await notify(prisma, {
      userId: referrer.userId,
      type: "REFERRAL_REWARD_APPLIED",
      title: "مكافأة إحالة!",
      body: `حصلت على ${pending.rewardValue} يومًا إضافيًا في اشتراكك لأن صديقًا دعوته اشترك بالفعل.`,
    });
  }

  return updatedReward;
}

export async function getReferralStats(prisma: PrismaClient, studentId: string) {
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } });
  const rewards = await prisma.referralReward.findMany({
    where: { referrerStudentId: studentId },
    include: { referred: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
  });
  return { referralCode: student.referralCode, rewards };
}
