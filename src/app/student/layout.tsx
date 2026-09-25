import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { NotificationBell } from "@/components/notification-bell";

const NAV_ITEMS = [
  { href: "/student", label: "لوحة التحكم" },
  { href: "/student/search", label: "البحث" },
  { href: "/student/analytics", label: "تحليلاتي" },
  { href: "/student/exams", label: "الامتحانات" },
  { href: "/student/saved-moments", label: "لحظاتي المحفوظة" },
  { href: "/student/parent-requests", label: "طلبات أولياء الأمور" },
  { href: "/student/games", label: "الألعاب" },
  { href: "/student/leaderboards", label: "لوحة الصدارة" },
  { href: "/student/hall-of-fame", label: "قاعة الشرف" },
  { href: "/student/achievements", label: "إنجازاتي" },
  { href: "/student/career-guidance", label: "التوجيه المهني" },
  { href: "/student/certificates", label: "شهاداتي" },
  { href: "/student/referral", label: "دعوة الأصدقاء" },
  { href: "/student/support", label: "الدعم الفني" },
  { href: "/student/announcements", label: "الإعلانات" },
  { href: "/student/store", label: "المتجر" },
  { href: "/student/orders", label: "طلباتي" },
  { href: "/student/subscribe", label: "الاشتراك" },
  { href: "/student/payments", label: "سجل المدفوعات" },
];

export default async function StudentLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "STUDENT") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Mobile: account row on top, the long nav becomes one horizontally
          scrollable row; desktop: side by side. The page itself never scrolls
          sideways. */}
      <header className="flex flex-col-reverse gap-3 border-b border-gray-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6 md:py-4 print:hidden">
        <nav aria-label="القائمة الرئيسية" className="-mx-1 flex min-w-0 gap-4 overflow-x-auto px-1 pb-1 md:flex-wrap md:gap-x-4 md:gap-y-2 md:overflow-visible md:pb-0">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="shrink-0 whitespace-nowrap text-sm font-medium">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3 self-end md:self-auto">
          <NotificationBell />
          <span className="text-sm text-gray-500">{session.user.name}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="text-sm text-gray-500 hover:underline">
              تسجيل الخروج
            </button>
          </form>
        </div>
      </header>
      <main className="min-w-0 flex-1 bg-gray-50 p-4 md:p-6">{children}</main>
    </div>
  );
}
