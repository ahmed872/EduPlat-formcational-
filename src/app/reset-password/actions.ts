"use server";

import { prisma } from "@/lib/prisma";
import { resetPasswordWithToken } from "@/lib/business/password-reset";

export type ResetPasswordState = { ok: boolean; code?: string; message: string } | null;

export async function submitNewPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) {
    return { ok: false, code: "MISMATCH", message: "كلمتا المرور غير متطابقتين" };
  }
  const result = await resetPasswordWithToken(prisma, { token, newPassword: password });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, message: "تم تغيير كلمة المرور. تم إنهاء كل الجلسات السابقة — سجّل الدخول بكلمة المرور الجديدة." };
}
