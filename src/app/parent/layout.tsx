import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

export default async function ParentLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 md:px-6 md:py-4 print:hidden">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-sm font-medium">لوحة ولي الأمر</h1>
          <Link href="/parent/support" className="text-sm text-gray-500 hover:underline">
            الدعم الفني
          </Link>
          <Link href="/parent/announcements" className="text-sm text-gray-500 hover:underline">
            الإعلانات
          </Link>
          <Link href="/account/password" className="text-sm text-gray-500 hover:underline">
            تغيير كلمة المرور
          </Link>
        </div>
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
      </header>
      <main className="min-w-0 flex-1 bg-gray-50 p-4 md:p-6">{children}</main>
    </div>
  );
}
