import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

const NAV_ITEMS = [
  { href: "/teacher", label: "لوحة التحكم" },
  { href: "/teacher/search", label: "البحث" },
  { href: "/teacher/accounts", label: "إدارة الحسابات" },
  { href: "/teacher/audit-log", label: "سجل التدقيق" },
  { href: "/teacher/analytics", label: "التحليلات" },
  { href: "/teacher/reports", label: "تقارير الطلاب" },
  { href: "/teacher/games", label: "الألعاب" },
  { href: "/teacher/leaderboards", label: "لوحة الصدارة" },
  { href: "/teacher/hall-of-fame", label: "قاعة الشرف" },
  { href: "/teacher/achievements", label: "الإنجازات" },
  { href: "/teacher/career-fields", label: "المجالات المهنية" },
  { href: "/teacher/certificates", label: "الشهادات" },
  { href: "/teacher/profile", label: "ملفي الشخصي" },
  { href: "/teacher/support", label: "الدعم الفني" },
  { href: "/teacher/announcements", label: "الإعلانات" },
  { href: "/teacher/products", label: "منتجات المتجر" },
  { href: "/teacher/orders", label: "طلبات المتجر" },
  { href: "/teacher/banners", label: "إعلانات الصفحة الرئيسية" },
  { href: "/teacher/categories", label: "الأقسام" },
  { href: "/teacher/courses", label: "الكورسات" },
  { href: "/teacher/shorts", label: "Shorts" },
  { href: "/teacher/question-bank", label: "بنك الأسئلة" },
  { href: "/teacher/exams", label: "الامتحانات" },
  { href: "/teacher/grading", label: "التصحيح اليدوي" },
  { href: "/teacher/subscriptions", label: "خطط الاشتراك" },
  { href: "/teacher/promo-codes", label: "أكواد الخصم" },
  { href: "/teacher/payments", label: "المدفوعات" },
  { href: "/teacher/targets", label: "أهداف المذاكرة" },
];

export default async function TeacherLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  // Defense in depth: middleware.ts already gates /teacher/*, but every
  // server component that renders sensitive data re-checks role itself
  // rather than trusting routing alone.
  if (!session?.user || session.user.role !== "TEACHER_ADMIN") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-l border-gray-200 bg-white p-4">
        <p className="mb-6 text-sm text-gray-500">
          مرحبًا، {session?.user.name}
        </p>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm hover:bg-indigo-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
          className="mt-6"
        >
          <button
            type="submit"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            تسجيل الخروج
          </button>
        </form>
      </aside>
      <main className="flex-1 bg-gray-50 p-8">{children}</main>
    </div>
  );
}
