import type { PrismaClient, PromoCode } from "@prisma/client";
import {
  PLATFORM_SETTING_KEYS,
  getPlatformSetting,
} from "@/lib/platform-settings";
import { applyDiscount, redeemPromoCode, validatePromoCode } from "@/lib/business/promo-code";
import {
  grantEntitlementsForPromoRedemption,
  grantEntitlementsForSubscription,
} from "@/lib/business/video-access";
import { getActivePaymentProvider } from "@/lib/payments/provider";
import { notify } from "@/lib/business/notifications";

async function notifySubscriptionActivated(prisma: PrismaClient, studentId: string, planName: string) {
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: { userId: true },
  });
  if (!student) return;
  await notify(prisma, {
    userId: student.userId,
    type: "SUBSCRIPTION_ACTIVATED",
    title: "تم تفعيل اشتراكك",
    body: `تم تفعيل اشتراكك في "${planName}" ويمكنك الآن الوصول للمحتوى المشمول.`,
  });
}

/**
 * The platform-wide default: subscriptions expire at the configured
 * academic-year end, never "+1 month from purchase". Configurable via
 * PlatformSetting (see src/lib/platform-settings.ts), never hardcoded.
 */
export async function computeAcademicYearExpiry(): Promise<Date> {
  const raw = await getPlatformSetting<string>(
    PLATFORM_SETTING_KEYS.ACADEMIC_YEAR_END,
  );
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${PLATFORM_SETTING_KEYS.ACADEMIC_YEAR_END} platform setting: ${raw}`);
  }
  return date;
}

/**
 * Starts a subscription purchase. Never marks a non-zero payment as paid —
 * that only happens through confirmPayment(), performed by a
 * teacher/admin after real money is actually received (see
 * src/lib/payments/provider.ts for why). A promo code that brings the
 * price to zero is the one legitimate case where the subscription goes
 * ACTIVE immediately, because there is genuinely nothing left to collect.
 */
export async function startSubscriptionCheckout(
  prisma: PrismaClient,
  params: { studentId: string; planId: string; promoCode?: string },
) {
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
    where: { id: params.planId },
  });
  if (!plan.active) {
    throw new Error("This subscription plan is not currently available");
  }

  let promo: PromoCode | null = null;
  let promoIdForRecord: string | null = null;
  if (params.promoCode) {
    const validation = await validatePromoCode(prisma, {
      code: params.promoCode,
      studentId: params.studentId,
    });
    if (!validation.valid) {
      throw new Error(`Promo code invalid: ${validation.reason}`);
    }
    const redemption = await redeemPromoCode(prisma, {
      code: params.promoCode,
      studentId: params.studentId,
    });
    promo = await prisma.promoCode.findUniqueOrThrow({
      where: { id: redemption.promoId },
    });
    promoIdForRecord = promo.id;
  }

  const originalAmountCents = plan.priceCents;
  const amountCents = promo ? applyDiscount(originalAmountCents, promo) : originalAmountCents;
  const expiresAt = await computeAcademicYearExpiry();
  const provider = getActivePaymentProvider(amountCents);
  const intent = await provider.createIntent({
    amountCents,
    currency: plan.currency,
    subscriptionId: "pending", // real ref not known until the row exists; kept for interface symmetry
  });

  const subscription = await prisma.subscription.create({
    data: {
      studentId: params.studentId,
      planId: plan.id,
      promoCodeId: promoIdForRecord,
      expiresAt,
      status: intent.status === "SUCCEEDED" ? "ACTIVE" : "PENDING_PAYMENT",
    },
  });

  const payment = await prisma.payment.create({
    data: {
      subscriptionId: subscription.id,
      amountCents,
      originalAmountCents,
      currency: plan.currency,
      provider: intent.provider,
      providerRef: intent.providerRef,
      status: intent.status,
      verifiedAt: intent.status === "SUCCEEDED" ? new Date() : null,
    },
  });

  if (intent.status === "SUCCEEDED") {
    await grantEntitlementsForSubscription(prisma, subscription.id);
    await notifySubscriptionActivated(prisma, params.studentId, plan.name);
  }

  return { subscription, payment, instructions: intent.instructions };
}

/**
 * A teacher/admin confirming that real money was actually received for a
 * pending manual/offline payment. This is the ONLY path that can turn a
 * non-zero Payment into SUCCEEDED — never an automated/client-driven one.
 */
export async function confirmPayment(
  prisma: PrismaClient,
  params: { paymentId: string; adminUserId: string },
) {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: params.paymentId },
  });
  if (payment.status !== "PENDING") {
    throw new Error(`Cannot confirm a payment in status ${payment.status}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const confirmedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCEEDED",
        verifiedAt: new Date(),
        confirmedById: params.adminUserId,
      },
    });
    await tx.subscription.update({
      where: { id: payment.subscriptionId },
      data: { status: "ACTIVE" },
    });
    await tx.auditLog.create({
      data: {
        actorId: params.adminUserId,
        action: "CONFIRM_PAYMENT",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { subscriptionId: payment.subscriptionId, amountCents: payment.amountCents },
      },
    });
    return confirmedPayment;
  });

  // Outside the transaction: this does its own $transaction internally and
  // is only reached once, guarded by the PENDING status check above.
  await grantEntitlementsForSubscription(prisma, payment.subscriptionId);

  const subscriptionWithPlan = await prisma.subscription.findUniqueOrThrow({
    where: { id: payment.subscriptionId },
    include: { plan: true },
  });
  await notifySubscriptionActivated(
    prisma,
    subscriptionWithPlan.studentId,
    subscriptionWithPlan.plan.name,
  );

  return updated;
}

export async function rejectPayment(
  prisma: PrismaClient,
  params: { paymentId: string; adminUserId: string; reason: string },
) {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: params.paymentId },
  });
  if (payment.status !== "PENDING") {
    throw new Error(`Cannot reject a payment in status ${payment.status}`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureReason: params.reason },
    });
    await tx.subscription.update({
      where: { id: payment.subscriptionId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: params.adminUserId,
        action: "REJECT_PAYMENT",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { subscriptionId: payment.subscriptionId, reason: params.reason },
      },
    });
    return updated;
  });
}

export async function refundPayment(
  prisma: PrismaClient,
  params: { paymentId: string; adminUserId: string; reason: string },
) {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: params.paymentId },
  });
  if (payment.status !== "SUCCEEDED") {
    throw new Error(`Cannot refund a payment in status ${payment.status}`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", failureReason: params.reason },
    });
    await tx.subscription.update({
      where: { id: payment.subscriptionId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await tx.entitlement.updateMany({
      where: { subscriptionId: payment.subscriptionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: params.adminUserId,
        action: "REFUND_PAYMENT",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { subscriptionId: payment.subscriptionId, reason: params.reason },
      },
    });
    return updated;
  });
}

/**
 * Redeems a promo code whose type grants content directly (FREE_LESSON /
 * FREE_PACKAGE / FREE_100 / FREE_PERIOD) without any subscription/payment
 * involved. FREE_PERIOD is bounded to the academic year; the others are
 * permanent grants.
 */
export async function redeemFreeContentPromo(
  prisma: PrismaClient,
  params: { code: string; studentId: string },
) {
  const promo = await prisma.promoCode.findUnique({ where: { code: params.code } });
  if (!promo) throw new Error("Promo code not found");
  const freeTypes = ["FREE_LESSON", "FREE_PACKAGE", "FREE_100", "FREE_PERIOD"];
  if (!freeTypes.includes(promo.type)) {
    throw new Error(
      `Promo code type ${promo.type} does not grant content directly — use startSubscriptionCheckout instead`,
    );
  }

  const redemption = await redeemPromoCode(prisma, {
    code: params.code,
    studentId: params.studentId,
  });

  const expiresAt =
    promo.type === "FREE_PERIOD" ? await computeAcademicYearExpiry() : undefined;

  const grantedCount = await grantEntitlementsForPromoRedemption(prisma, {
    promoId: promo.id,
    redemptionId: redemption.id,
    studentId: params.studentId,
    expiresAt,
  });

  return { redemption, grantedCount };
}

/**
 * Reporting/UI convenience: flips DB `status` to EXPIRED for subscriptions
 * past their `expiresAt`. Access control never depends on this running
 * (checkVideoAccess already evaluates `expiresAt` dynamically), but the
 * teacher/student dashboards read `status` directly, so this keeps it
 * truthful. Invoked opportunistically on dashboard loads today; a real
 * background scheduler is the eventual home for it (see PROJECT_STATUS.md).
 */
export async function syncExpiredSubscriptions(prisma: PrismaClient) {
  const result = await prisma.subscription.updateMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}
