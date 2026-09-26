"use server";

import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordResetRequest, requestPasswordReset } from "@/lib/business/password-reset";
import { getPasswordResetDelivery, passwordResetDeliveryKind } from "@/lib/business/password-reset-delivery";

export type ForgotPasswordState = { status: "sent" | "rate_limited" | "invalid"; message: string } | null;

// The answer depends only on whether a delivery channel is configured (a
// deployment-wide fact), never on the account. With no email/SMS provider
// it says so instead of claiming a link was sent.
const GENERIC_RESET_MESSAGE = {
  "dev-outbox":
    "إذا كان هذا البريد مسجلًا لدينا فسيصل إليه رابط لإعادة تعيين كلمة المرور صالح لمدة 30 دقيقة. (بيئة تطوير: الرابط يُكتب في صندوق الرسائل المحلي ولا يُرسل بريد فعلي.)",
  "not-configured":
    "تم استلام طلبك. الإرسال التلقائي بالبريد غير مفعّل حاليًا على المنصة، لذلك تواصل مع المعلم/إدارة المنصة ليصدر لك رابط إعادة تعيين يُسلَّم إليك مباشرة.",
} as const;

/**
 * Same answer whether or not an account exists. Only the rate-limit
 * bookkeeping (identical for every address) runs before the response; the
 * account lookup, token creation and delivery run after it has been sent,
 * so response time doesn't reveal whether the account exists either.
 */
export async function requestReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const parsed = z.string().trim().email().max(254).safeParse(formData.get("email"));
  if (!parsed.success) {
    return { status: "invalid", message: "أدخل بريدًا إلكترونيًا صحيحًا" };
  }
  const email = parsed.data;

  const { limited } = await recordResetRequest(prisma, { email });
  if (limited) {
    return { status: "rate_limited", message: "طلبات كثيرة لهذا البريد. انتظر 15 دقيقة ثم أعد المحاولة." };
  }

  after(async () => {
    try {
      await requestPasswordReset(prisma, { email, deliver: getPasswordResetDelivery() });
    } catch (error) {
      // Never log the email or any token.
      console.error("[password-reset] processing a reset request failed:", error instanceof Error ? error.name : "unknown");
    }
  });
  return { status: "sent", message: GENERIC_RESET_MESSAGE[passwordResetDeliveryKind()] };
}
