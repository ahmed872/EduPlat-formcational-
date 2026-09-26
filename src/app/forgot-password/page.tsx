import Link from "next/link";
import { passwordResetDeliveryKind } from "@/lib/business/password-reset-delivery";
import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const emailDelivery = passwordResetDeliveryKind() !== "not-configured";
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-bold">نسيت كلمة المرور</h1>
        <p className="mt-2 text-sm text-gray-600">
          أدخل بريدك الإلكتروني المسجل لطلب رابط لإعادة تعيين كلمة المرور.
        </p>
      </div>
      {!emailDelivery && (
        <p data-testid="reset-delivery-notice" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          الإرسال التلقائي بالبريد الإلكتروني غير مفعّل حاليًا على المنصة. إذا نسيت كلمة المرور، تواصل مع المعلم/إدارة
          المنصة ليصدر لك رابط إعادة تعيين يُسلَّم إليك مباشرة (صالح لمرة واحدة ولمدة محدودة).
        </p>
      )}
      <ForgotPasswordForm />
      <Link href="/login" className="text-center text-sm text-indigo-700 hover:underline">
        العودة لتسجيل الدخول
      </Link>
    </main>
  );
}
