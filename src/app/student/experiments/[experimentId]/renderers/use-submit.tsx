"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitAttempt } from "../actions";

export type Feedback = { passed: boolean; message: string } | { error: string } | null;

/** Sends a submission for server-side grading; the page refreshes on a pass. */
export function useSubmitAttempt(experimentId: string, attemptId: string) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  function submit(submission: unknown) {
    startTransition(async () => {
      const result = await submitAttempt(experimentId, attemptId, submission);
      if (!result.ok) {
        setFeedback({ error: result.error });
        return;
      }
      setFeedback({ passed: result.value.passed, message: result.value.message });
      if (result.value.passed) router.refresh();
    });
  }

  return { submit, feedback, pending };
}

export function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  if ("error" in feedback) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
        {feedback.error}
      </p>
    );
  }
  return (
    <p
      role="status"
      data-testid="experiment-feedback"
      className={
        feedback.passed
          ? "rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"
          : "rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
      }
    >
      {feedback.message}
    </p>
  );
}
