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
  { href: "/teacher/entitlements", label: "منح وصول استثنائي" },
  { href: "/teacher/targets", label: "أهداف المذاكرة" },
  { href: "/account/password", label: "تغيير كلمة المرور" },
];

export default async function TeacherLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  // Defense in depth: proxy.ts (this repo's edge middleware, renamed per
  // AGENTS.md) already gates /teacher/* at the edge, but every
  // server component that renders sensitive data re-checks role itself
  // rather than trusting routing alone.
  if (!session?.user || session.user.role !== "TEACHER_ADMIN") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Mobile: a top bar with a horizontally scrollable nav; desktop: sidebar. */}
      <aside className="w-full shrink-0 border-b border-gray-200 bg-white p-3 md:w-64 md:border-b-0 md:border-l md:p-4 print:hidden">
        <p className="mb-2 text-sm text-gray-600 md:mb-6">
          مرحبًا، {session?.user.name}
        </p>
        <nav aria-label="قائمة المعلم" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-indigo-50"
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
          className="mt-2 md:mt-6"
        >
          <button
            type="submit"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            تسجيل الخروج
          </button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 bg-gray-50 p-4 md:p-8">{children}</main>
    </div>
  );
}
