"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeAttempt } from "./actions";

export function ExperimentRunner({
  experimentId,
  attemptId,
  steps,
  embedUrl,
}: {
  experimentId: string;
  attemptId: string;
  steps: string[];
  embedUrl?: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [isPending, startTransition] = useTransition();

  const allChecked = steps.length === 0 || steps.every((_, i) => checked[i]);

  function toggle(index: number) {
    setChecked((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  function handleComplete() {
    const checkedSteps = steps.filter((_, i) => checked[i]);
    startTransition(async () => {
      await completeAttempt(experimentId, attemptId, checkedSteps);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {embedUrl && (
        <a
          href={embedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block w-fit rounded-md bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-900"
        >
          فتح التجربة في نافذة جديدة
        </a>
      )}

      {steps.length > 0 && (
        <ul className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!checked[i]}
                onChange={() => toggle(i)}
                id={`step-${i}`}
              />
              <label htmlFor={`step-${i}`} className="text-sm">
                {step}
              </label>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={handleComplete}
        disabled={!allChecked || isPending}
        className="w-fit rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "جارٍ الحفظ..." : "إنهاء التجربة"}
      </button>
      {!allChecked && (
        <p className="text-xs text-amber-600">أكمل كل الخطوات أولًا لإنهاء التجربة.</p>
      )}
    </div>
  );
}
