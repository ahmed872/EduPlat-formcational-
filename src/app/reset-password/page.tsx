import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-bold">تعيين كلمة مرور جديدة</h1>
        <p className="mt-2 text-sm text-gray-600">الرابط صالح لمرة واحدة فقط ولمدة محدودة.</p>
      </div>
      <ResetPasswordForm />
    </main>
  );
}
