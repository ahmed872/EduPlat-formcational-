"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { submitNewPassword, type ResetPasswordState } from "./actions";

/**
 * The token arrives in the URL fragment (#token=…), which is never sent to
 * the server in the page request. It is read here, removed from the
 * address bar right away, and posted only with the form.
 */
export function ResetPasswordForm() {
  const [token, setToken] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(submitNewPassword, null);

  useEffect(() => {
    const match = window.location.hash.match(/token=([A-Za-z0-9_-]+)/);
    // Reading the fragment is only possible after mount (it never reaches the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(match ? match[1] : "");
    if (match) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (state?.ok) {
    return (
      <div data-testid="reset-password-done" className="flex flex-col gap-3 rounded-md bg-green-50 p-4 text-sm text-green-800">
        <p role="status">{state.message}</p>
        <Link href="/login?reset=1" className="font-semibold text-indigo-700 hover:underline">
          الذهاب لتسجيل الدخول
        </Link>
      </div>
    );
  }
  if (token === null) return null;
  if (token === "") {
    return (
      <p data-testid="reset-password-missing" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
        الرابط غير مكتمل. افتح الرابط كما وصلك تمامًا، أو <Link href="/forgot-password" className="underline">اطلب رابطًا جديدًا</Link>.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">كلمة المرور الجديدة (8 أحرف على الأقل)</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className="rounded-md border border-gray-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">تأكيد كلمة المرور الجديدة</span>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className="rounded-md border border-gray-300 px-3 py-2" />
      </label>
      {state && !state.ok && (
        <p role="alert" data-testid="reset-password-error" data-code={state.code} className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.message}
          {state.code === "INVALID_TOKEN" && (
            <>
              {" "}
              <Link href="/forgot-password" className="underline">
                طلب رابط جديد
              </Link>
            </>
          )}
        </p>
      )}
      <button type="submit" disabled={pending} className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "جارٍ الحفظ..." : "حفظ كلمة المرور الجديدة"}
      </button>
    </form>
  );
}
