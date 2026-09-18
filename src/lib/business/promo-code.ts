import type { PrismaClient } from "@prisma/client";

export type PromoValidationResult =
  | { valid: true }
  | {
      valid: false;
      reason: "NOT_FOUND" | "INACTIVE" | "EXPIRED" | "USAGE_LIMIT_REACHED" | "ALREADY_REDEEMED";
    };

export async function validatePromoCode(
  prisma: PrismaClient,
  params: { code: string; studentId: string },
): Promise<PromoValidationResult> {
  const promo = await prisma.promoCode.findUnique({
    where: { code: params.code },
  });
  if (!promo) return { valid: false, reason: "NOT_FOUND" };
  if (!promo.active) return { valid: false, reason: "INACTIVE" };
  if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) {
    return { valid: false, reason: "EXPIRED" };
  }
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
    return { valid: false, reason: "USAGE_LIMIT_REACHED" };
  }

  const alreadyRedeemed = await prisma.promoRedemption.findUnique({
    where: { promoId_studentId: { promoId: promo.id, studentId: params.studentId } },
  });
  if (alreadyRedeemed) return { valid: false, reason: "ALREADY_REDEEMED" };

  return { valid: true };
}

/**
 * Validates and redeems atomically so two concurrent redemptions can never
 * both slip through a usage-limit-reached code.
 */
export async function redeemPromoCode(
  prisma: PrismaClient,
  params: { code: string; studentId: string },
) {
  return prisma.$transaction(async (tx) => {
    const promo = await tx.promoCode.findUnique({ where: { code: params.code } });
    if (!promo) throw new Error("Promo code not found");
    if (!promo.active) throw new Error("Promo code is inactive");
    if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) {
      throw new Error("Promo code has expired");
    }
    if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
      throw new Error("Promo code usage limit reached");
    }

    const redemption = await tx.promoRedemption.create({
      data: { promoId: promo.id, studentId: params.studentId },
    });

    await tx.promoCode.update({
      where: { id: promo.id },
      data: { usedCount: { increment: 1 } },
    });

    return redemption;
  });
}

/** Percentage/fixed discount math, kept separate from any payment provider. */
export function applyDiscount(
  amountCents: number,
  promo: { type: string; value: number | null },
): number {
  if (promo.type === "PERCENT_DISCOUNT" && promo.value) {
    return Math.max(0, Math.round(amountCents * (1 - promo.value / 100)));
  }
  if (promo.type === "FIXED_DISCOUNT" && promo.value) {
    return Math.max(0, amountCents - Math.round(promo.value));
  }
  if (promo.type === "FREE_100") {
    return 0;
  }
  return amountCents;
}
