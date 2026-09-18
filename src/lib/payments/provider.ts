/**
 * Payment-provider abstraction. No real gateway (Stripe/PayMob/Fawry/...)
 * is configured in this environment — swapping one in means implementing
 * this interface and changing `getActivePaymentProvider()` below, without
 * touching any of the subscription/checkout business logic that calls it.
 *
 * The one provider implemented today, `ManualOfflinePaymentProvider`, never
 * marks a payment as paid by itself. It only records the intent; a
 * teacher/admin must manually confirm that money was actually received
 * (bank transfer, cash, mobile wallet, ...) via `confirmPayment()` in
 * `src/lib/business/subscription.ts`. This is intentional: the spec
 * explicitly forbids faking a successful payment.
 */
export interface PaymentIntent {
  provider: string;
  providerRef: string | null;
  /** Whether this provider can determine success synchronously (only true for zero-amount "payments"). */
  status: "PENDING" | "SUCCEEDED";
  instructions: string;
}

export interface PaymentProvider {
  readonly name: string;
  createIntent(params: {
    amountCents: number;
    currency: string;
    subscriptionId: string;
  }): Promise<PaymentIntent>;
}

class ManualOfflinePaymentProvider implements PaymentProvider {
  readonly name = "MANUAL_OFFLINE";

  async createIntent(params: {
    amountCents: number;
    currency: string;
  }): Promise<PaymentIntent> {
    return {
      provider: this.name,
      providerRef: null,
      status: "PENDING",
      instructions:
        `المبلغ المطلوب ${(params.amountCents / 100).toFixed(2)} ${params.currency}. ` +
        "برجاء التحويل عبر الطريقة المعتمدة من المعلم ثم انتظار تأكيد الإدارة لتفعيل الاشتراك.",
    };
  }
}

class FreePaymentProvider implements PaymentProvider {
  readonly name = "FREE";

  async createIntent(): Promise<PaymentIntent> {
    return {
      provider: this.name,
      providerRef: null,
      status: "SUCCEEDED", // nothing to collect — genuinely free, not a simulated charge
      instructions: "لا توجد رسوم مطلوبة.",
    };
  }
}

const manualOfflineProvider = new ManualOfflinePaymentProvider();
const freeProvider = new FreePaymentProvider();

/**
 * Selects the provider for a given amount. Once a real gateway is
 * configured (env vars present), this is the only function that needs to
 * change to route non-zero amounts to it instead of the manual/offline flow.
 */
export function getActivePaymentProvider(amountCents: number): PaymentProvider {
  if (amountCents <= 0) return freeProvider;
  return manualOfflineProvider;
}
