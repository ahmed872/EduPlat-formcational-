import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent, createSubscriptionPlan } from "@/test/factories";
import {
  applyPendingReferralReward,
  createPendingReferralReward,
  getReferralStats,
} from "@/lib/business/referral";
import { PLATFORM_SETTING_KEYS, setPlatformSetting } from "@/lib/platform-settings";

beforeEach(async () => {
  await resetDatabase();
});

async function createSubscriptionFor(studentId: string, expiresAt: Date) {
  const plan = await createSubscriptionPlan();
  return prisma.subscription.create({
    data: { studentId, planId: plan.id, expiresAt, status: "ACTIVE" },
  });
}

describe("createPendingReferralReward", () => {
  it("creates a pending reward for a valid referral code", async () => {
    const referrer = await createStudent();
    const referred = await createStudent();
    await setPlatformSetting(PLATFORM_SETTING_KEYS.REFERRAL_REWARD_DAYS, 10);

    const reward = await createPendingReferralReward(prisma, {
      referralCode: referrer.referralCode,
      referredStudentId: referred.id,
    });

    expect(reward).not.toBeNull();
    expect(reward!.referrerStudentId).toBe(referrer.id);
    expect(reward!.rewardValue).toBe(10);
    expect(reward!.appliedAt).toBeNull();
  });

  it("returns null and does not throw for an unknown referral code", async () => {
    const referred = await createStudent();

    const reward = await createPendingReferralReward(prisma, {
      referralCode: "NOT-A-REAL-CODE",
      referredStudentId: referred.id,
    });

    expect(reward).toBeNull();
  });

  it("never creates a self-referral reward", async () => {
    const student = await createStudent();

    const reward = await createPendingReferralReward(prisma, {
      referralCode: student.referralCode,
      referredStudentId: student.id,
    });

    expect(reward).toBeNull();
  });
});

describe("applyPendingReferralReward", () => {
  it("extends the referrer's most recent subscription by the reward's day count", async () => {
    const referrer = await createStudent();
    const referred = await createStudent();
    const originalExpiry = new Date("2026-01-01T00:00:00Z");
    await createSubscriptionFor(referrer.id, originalExpiry);
    await createPendingReferralReward(prisma, {
      referralCode: referrer.referralCode,
      referredStudentId: referred.id,
    });

    const applied = await applyPendingReferralReward(prisma, referred.id);

    expect(applied).not.toBeNull();
    expect(applied!.appliedAt).not.toBeNull();
    const subscription = await prisma.subscription.findFirst({ where: { studentId: referrer.id } });
    expect(subscription!.expiresAt.getTime()).toBeGreaterThan(originalExpiry.getTime());
  });

  it("returns null and leaves the reward unapplied when the referrer has no subscription", async () => {
    const referrer = await createStudent();
    const referred = await createStudent();
    await createPendingReferralReward(prisma, {
      referralCode: referrer.referralCode,
      referredStudentId: referred.id,
    });

    const result = await applyPendingReferralReward(prisma, referred.id);

    expect(result).toBeNull();
    const reward = await prisma.referralReward.findUnique({
      where: { referredStudentId: referred.id },
    });
    expect(reward!.appliedAt).toBeNull();
  });

  it("returns null when there is no pending reward for this student at all", async () => {
    const student = await createStudent();
    const result = await applyPendingReferralReward(prisma, student.id);
    expect(result).toBeNull();
  });

  it("never applies the same reward twice", async () => {
    const referrer = await createStudent();
    const referred = await createStudent();
    await createSubscriptionFor(referrer.id, new Date("2026-01-01T00:00:00Z"));
    await createPendingReferralReward(prisma, {
      referralCode: referrer.referralCode,
      referredStudentId: referred.id,
    });

    await applyPendingReferralReward(prisma, referred.id);
    const secondAttempt = await applyPendingReferralReward(prisma, referred.id);

    expect(secondAttempt).toBeNull();
  });

  it("never applies an already-expired reward", async () => {
    const referrer = await createStudent();
    const referred = await createStudent();
    await createSubscriptionFor(referrer.id, new Date("2026-01-01T00:00:00Z"));
    const reward = await createPendingReferralReward(prisma, {
      referralCode: referrer.referralCode,
      referredStudentId: referred.id,
    });
    await prisma.referralReward.update({
      where: { id: reward!.id },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });

    const result = await applyPendingReferralReward(prisma, referred.id);
    expect(result).toBeNull();
  });
});

describe("getReferralStats", () => {
  it("returns the student's own referral code and every reward they've earned as a referrer", async () => {
    const referrer = await createStudent();
    const referred = await createStudent();
    await createSubscriptionFor(referrer.id, new Date("2026-01-01T00:00:00Z"));
    await createPendingReferralReward(prisma, {
      referralCode: referrer.referralCode,
      referredStudentId: referred.id,
    });

    const stats = await getReferralStats(prisma, referrer.id);

    expect(stats.referralCode).toBe(referrer.referralCode);
    expect(stats.rewards).toHaveLength(1);
    expect(stats.rewards[0].referred.id).toBe(referred.id);
  });
});
