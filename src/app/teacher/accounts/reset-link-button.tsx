"use client";

import { useState, useTransition } from "react";
import { issueResetLink, type ResetLinkState } from "./actions";

/**
 * Shows the link once, for the teacher to hand over through a trusted
 * channel (e.g. in person or by phone). It is not stored anywhere readable
 * and disappears when the page is left.
 */
export function ResetLinkButton({ userId }: { userId: string }) {
  const [state, setState] = useState<ResetLinkState>(null);
  const [pending, startTransition] = useTransition();

  const url = state?.ok ? `${window.location.origin}${state.resetPath}` : null;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("إنشاء رابط إعادة تعيين كلمة المرور لهذا الحساب؟ سيُلغى أي رابط سابق.")) return;
          startTransition(async () => setState(await issueResetLink(userId)));
        }}
        className="w-fit text-xs text-indigo-700 hover:underline disabled:opacity-50"
      >
        {pending ? "جارٍ الإنشاء..." : "رابط إعادة تعيين كلمة المرور"}
      </button>
      {state && !state.ok && <p role="alert" className="text-xs text-red-600">{state.message}</p>}
      {url && state?.ok && (
        <div data-testid="reset-link-result" className="flex max-w-xs flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <input readOnly value={url} dir="ltr" aria-label="رابط إعادة التعيين" onFocus={(event) => event.currentTarget.select()} className="w-full rounded border border-amber-300 bg-white px-1 py-0.5 font-mono text-[11px]" />
          <span>
            صالح لمرة واحدة حتى {new Date(state.expiresAt).toLocaleString("ar-EG")}. سلّمه لصاحب الحساب بنفسك عبر قناة موثوقة — لن
            يظهر مرة أخرى.
          </span>
        </div>
      )}
    </div>
  );
}
