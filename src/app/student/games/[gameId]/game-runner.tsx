"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicGameQuestion } from "@/lib/business/games";
import { finishPlay } from "./actions";

export function GameRunner({
  gameId,
  sessionId,
  questions,
  durationMinutes,
  startedAt,
}: {
  gameId: string;
  sessionId: string;
  questions: PublicGameQuestion[];
  durationMinutes: number;
  startedAt: string;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The correct answer key is never sent to this component — the server
  // grades `answers` (the student's own choice per question) against the
  // real key and returns/derives the actual score itself.
  const answersRef = useRef<number[]>([]);

  const endsAtMs = useMemo(
    () => new Date(startedAt).getTime() + durationMinutes * 60_000,
    [startedAt, durationMinutes],
  );
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.round((endsAtMs - Date.now()) / 1000)),
  );

  async function finish() {
    if (finished) return;
    setFinished(true);
    setSubmitting(true);
    try {
      const result = await finishPlay(gameId, sessionId, answersRef.current);
      setFinalScore(result.score);
    } catch (err) {
      // The countdown shown here is a UI convenience only — the server
      // independently enforces the real deadline and rejects a late
      // submission with zero points, which can legitimately happen if the
      // request was delayed in flight even though this timer read >0.
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء إنهاء اللعبة");
      setFinalScore(0);
    } finally {
      setSubmitting(false);
    }
    router.refresh();
  }

  useEffect(() => {
    if (finished) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.round((endsAtMs - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        finish();
      }
    }, 500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAtMs, finished]);

  if (finished) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
        <p className="text-lg font-semibold">
          {submitting || finalScore === null
            ? "جارٍ الحفظ..."
            : error
              ? error
              : `انتهت اللعبة! نتيجتك: ${finalScore}`}
        </p>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
        لا توجد أسئلة في هذه اللعبة بعد.
      </div>
    );
  }

  const question = questions[index % questions.length];

  function handleAnswer(choiceIndex: number) {
    answersRef.current[index] = choiceIndex;

    if (index + 1 >= questions.length) {
      finish();
    } else {
      setIndex(index + 1);
    }
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-sm">
        <span>
          السؤال {index + 1} من {questions.length}
        </span>
        <span className="font-mono font-semibold">
          {minutes}:{String(seconds).padStart(2, "0")}
        </span>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="mb-4 font-medium">{question.prompt}</p>
        <div className="flex flex-col gap-2">
          {question.choices.map((choice, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleAnswer(i)}
              className="rounded-md border border-gray-300 px-4 py-2 text-right hover:bg-indigo-50"
            >
              {choice}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
