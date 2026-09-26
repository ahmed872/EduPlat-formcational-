import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ChangePasswordForm } from "./change-password-form";

const HOME_BY_ROLE: Record<string, string> = {
  STUDENT: "/student",
  PARENT: "/parent",
  TEACHER_ADMIN: "/teacher",
};

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/account/password");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-bold">تغيير كلمة المرور</h1>
        <p className="mt-2 text-sm text-gray-600">
          بعد التغيير يتم تسجيل خروجك من كل الأجهزة، بما فيها هذا الجهاز، وتحتاج لتسجيل الدخول من جديد.
        </p>
      </div>
      <ChangePasswordForm />
      <Link href={HOME_BY_ROLE[session.user.role] ?? "/"} className="text-center text-sm text-indigo-700 hover:underline">
        العودة للوحة التحكم
      </Link>
    </main>
  );
}
