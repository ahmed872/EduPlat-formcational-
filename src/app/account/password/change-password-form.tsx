"use client";

import { useActionState } from "react";
import { submitPasswordChange, type ChangePasswordState } from "./actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(submitPasswordChange, null);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">كلمة المرور الحالية</span>
        <input name="currentPassword" type="password" required autoComplete="current-password" className="rounded-md border border-gray-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">كلمة المرور الجديدة (8 أحرف على الأقل)</span>
        <input name="newPassword" type="password" required minLength={8} autoComplete="new-password" className="rounded-md border border-gray-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">تأكيد كلمة المرور الجديدة</span>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className="rounded-md border border-gray-300 px-3 py-2" />
      </label>
      {state && (
        <p role="alert" data-testid="change-password-error" data-code={state.code} className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "جارٍ الحفظ..." : "تغيير كلمة المرور"}
      </button>
    </form>
  );
}
