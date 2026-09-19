"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [role, setRole] = useState<"STUDENT" | "PARENT">("STUDENT");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
        referralCode: referralCode.trim() || undefined,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "حدث خطأ أثناء إنشاء الحساب");
      setSubmitting(false);
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setSubmitting(false);

    if (result?.error) {
      setError("تم إنشاء الحساب، برجاء تسجيل الدخول");
      router.push("/login");
      return;
    }
    router.push(role === "STUDENT" ? "/student" : "/parent");
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-center text-2xl font-bold">إنشاء حساب جديد</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">نوع الحساب</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as "STUDENT" | "PARENT")}
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="STUDENT">طالب</option>
            <option value="PARENT">ولي أمر</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الاسم</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
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
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        {role === "STUDENT" && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">كود الإحالة (اختياري)</span>
            <input
              value={referralCode}
              onChange={(event) => setReferralCode(event.target.value)}
              placeholder="إن كان لديك كود من صديق"
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? "جاري الإنشاء..." : "إنشاء حساب"}
        </button>
      </form>
    </main>
  );
}
