"use server";

import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { changePassword } from "@/lib/business/password-reset";

export type ChangePasswordState = { ok: false; code: string; message: string } | null;

export async function submitPasswordChange(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const session = await auth();
  requireSession(session);

  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword !== String(formData.get("confirm") ?? "")) {
    return { ok: false, code: "MISMATCH", message: "كلمتا المرور الجديدتان غير متطابقتين" };
  }
  const result = await changePassword(prisma, {
    userId: session.user.id,
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword,
  });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  // Every session, this one included, is now invalid (sessionVersion moved);
  // clear this browser's cookie and ask for a fresh sign-in.
  await signOut({ redirectTo: "/login?passwordChanged=1" });
  return null;
}
