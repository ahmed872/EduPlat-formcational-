"use client";

import { useActionState } from "react";
import { requestReset, type ForgotPasswordState } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(requestReset, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">البريد الإلكتروني المسجل</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          dir="ltr"
          className="rounded-md border border-gray-300 px-3 py-2 text-left"
        />
      </label>
      {state && (
        <p
          role="status"
          data-testid="forgot-password-result"
          data-status={state.status}
          className={`rounded-md p-3 text-sm ${state.status === "sent" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "جارٍ الإرسال..." : "إرسال رابط إعادة التعيين"}
      </button>
    </form>
  );
}
