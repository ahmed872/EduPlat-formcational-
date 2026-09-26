"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MISSING_CSRF_ERROR, signInWithCsrfRetry } from "@/lib/sign-in-with-csrf-retry";
import { safeCallbackPath } from "@/lib/safe-redirect";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signInWithCsrfRetry(() =>
      signIn("credentials", {
        email,
        password,
        redirect: false,
      }),
    );

    setSubmitting(false);
    if (result?.error === MISSING_CSRF_ERROR) {
      setError("تعذّر التحقق من الجلسة — حدّث الصفحة ثم أعد المحاولة");
      return;
    }
    if (result?.error) {
      setError("البريد الإلكتروني أو كلمة المرور غير صحيحة");
      return;
    }
    router.push(safeCallbackPath(searchParams.get("callbackUrl")));
    router.refresh();
  }

  const notice =
    searchParams.get("reset") === "1"
      ? "تم تعيين كلمة المرور الجديدة. سجّل الدخول بها."
      : searchParams.get("passwordChanged") === "1"
        ? "تم تغيير كلمة المرور وتسجيل خروجك من كل الأجهزة. سجّل الدخول بكلمة المرور الجديدة."
        : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {notice && (
        <p role="status" data-testid="login-notice" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">البريد الإلكتروني</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-gray-600">كلمة المرور</span>
        <input
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {submitting ? "جاري الدخول..." : "دخول"}
      </button>
      <Link href="/forgot-password" className="text-center text-sm text-indigo-700 hover:underline">
        نسيت كلمة المرور؟
      </Link>
    </form>
  );
}
