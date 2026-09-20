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
 *
 * The usage-limit check+increment is itself a single conditional UPDATE
 * (`WHERE usedCount < usageLimit`), not a read-then-write — under Postgres's
 * default READ COMMITTED isolation, a plain check followed by a separate
 * increment (even inside a transaction) lets two concurrent redemptions
 * near the cap both read a stale usedCount and both pass, pushing usedCount
 * past usageLimit. The conditional UPDATE makes the check and the write
 * atomic: only requests that still see room under the cap can succeed.
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

    if (promo.usageLimit !== null) {
      const claimed = await tx.promoCode.updateMany({
        where: { id: promo.id, usedCount: { lt: promo.usageLimit } },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new Error("Promo code usage limit reached");
      }
    } else {
      await tx.promoCode.update({
        where: { id: promo.id },
        data: { usedCount: { increment: 1 } },
      });
    }

    // @@unique([promoId, studentId]) on PromoRedemption is the backstop
    // against the SAME student redeeming twice concurrently — a violation
    // here throws and rolls back the usedCount increment above too, since
    // both are in the same transaction.
    return tx.promoRedemption.create({
      data: { promoId: promo.id, studentId: params.studentId },
    });
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
