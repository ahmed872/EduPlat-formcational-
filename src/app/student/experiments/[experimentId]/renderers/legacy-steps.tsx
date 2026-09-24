"use client";

import { useState } from "react";
import type { LegacyPublic } from "@/lib/experiments/definitions";
import { FeedbackBanner, useSubmitAttempt } from "./use-submit";

/** Pre-registry guided-steps experiments; the server requires every step. */
export function LegacyStepsRenderer({
  experimentId,
  attemptId,
  experiment,
}: {
  experimentId: string;
  attemptId: string;
  experiment: LegacyPublic;
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const { submit, feedback, pending } = useSubmitAttempt(experimentId, attemptId);

  function toggle(index: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {experiment.embedUrl && (
        <a
          href={experiment.embedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block w-fit rounded-md bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-900"
        >
          فتح التجربة في نافذة جديدة
        </a>
      )}
      <ul className="flex flex-col gap-2">
        {experiment.steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2">
            <input type="checkbox" id={`step-${i}`} checked={checked.has(i)} onChange={() => toggle(i)} />
            <label htmlFor={`step-${i}`} className="text-sm">
              {step}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={pending || checked.size !== experiment.steps.length}
        onClick={() => submit({ acknowledged: Array.from(checked) })}
        className="w-fit rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? "جارٍ الحفظ..." : "إنهاء التجربة"}
      </button>
      <FeedbackBanner feedback={feedback} />
    </div>
  );
}
