"use client";

import { useActionState, useRef } from "react";
import { uploadLessonAttachment, type AttachmentFormState } from "../actions";

export function AttachmentUpload({
  courseId,
  lessonId,
  accept,
}: {
  courseId: string;
  lessonId: string;
  accept: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<AttachmentFormState, FormData>(
    async (prev, formData) => {
      const result = await uploadLessonAttachment(courseId, lessonId, prev, formData);
      if (result?.ok) formRef.current?.reset();
      return result;
    },
    null,
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2" data-attachment-upload={lessonId}>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-600">الملف (PDF، صورة، DOCX، PPTX — حتى 25 ميجابايت)</span>
        <input name="file" type="file" required accept={accept} className="text-xs" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-600">اسم يظهر للطالب (اختياري)</span>
        <input name="label" maxLength={120} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gray-200 px-3 py-1.5 text-xs hover:bg-gray-300 disabled:opacity-50"
      >
        {pending ? "جارٍ الرفع..." : "رفع ملف"}
      </button>
      {state && (
        <p role="status" className={`basis-full text-xs ${state.ok ? "text-green-700" : "text-red-600"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
