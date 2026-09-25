"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MiniGamePublic, MiniGameState } from "@/lib/experiments/definitions";
import { playMove } from "../actions";

/**
 * A timed speed round: one question at a time, lives (♥), a streak counter
 * and instant feedback. Every answer is a server move — the server keeps the
 * game state, checks answers against a key the browser never sees, and
 * measures the time limit from the attempt's own server-side start.
 */
export function MiniGameRenderer({
  experimentId,
  attemptId,
  experiment,
  startedAt,
  initialState,
}: {
  experimentId: string;
  attemptId: string;
  experiment: MiniGamePublic;
  startedAt: string;
  initialState: MiniGameState | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<MiniGameState>(
    initialState ?? {
      answers: [],
      correct: 0,
      streak: 0,
      bestStreak: 0,
      livesLeft: experiment.lives,
      done: false,
    },
  );
  const [flash, setFlash] = useState<{ correct: boolean } | null>(null);
  const [result, setResult] = useState<{ passed: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Last time we told the server the clock ran out; retried every few
  // seconds in case the browser clock is slightly ahead of the server's.
  const timeoutSentAt = useRef(0);

  const endsAt = useMemo(
    () => new Date(startedAt).getTime() + experiment.timeLimitSeconds * 1000,
    [startedAt, experiment.timeLimitSeconds],
  );
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));

  function send(move: unknown) {
    startTransition(async () => {
      const response = await playMove(experimentId, attemptId, move);
      if (!response.ok) {
        // An early timeout is simply retried by the timer; don't alarm the student.
        if (!(move as { timeout?: boolean }).timeout) setError(response.error);
        return;
      }
      setError(null);
      setState(response.value.state);
      if (response.value.correct !== null) setFlash({ correct: response.value.correct });
      if (response.value.finished) {
        setResult({ passed: response.value.finished.passed, message: response.value.finished.message });
      }
    });
  }

  useEffect(() => {
    if (result) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && Date.now() - timeoutSentAt.current > 3000) {
        timeoutSentAt.current = Date.now();
        send({ timeout: true });
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, result]);

  const index = state.answers.length;
  const question = experiment.questions[index];

  if (result) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4" data-testid="game-result">
        <p className={result.passed ? "text-lg font-bold text-green-700" : "text-lg font-bold text-amber-700"}>
          {result.message}
        </p>
        <p className="text-sm text-gray-600">
          النتيجة: {state.correct} / {experiment.questions.length} · أفضل سلسلة: {state.bestStreak}
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          {result.passed ? "متابعة" : "العودة لبدء جولة جديدة"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-indigo-100 bg-white p-4" data-testid="mini-game">
      <div className="flex items-center justify-between text-sm">
        <span aria-label="المحاولات المتبقية" className="text-lg text-red-600">
          {"♥".repeat(Math.max(0, state.livesLeft))}
          <span className="text-gray-300">{"♥".repeat(Math.max(0, experiment.lives - state.livesLeft))}</span>
        </span>
        <span className="font-semibold text-indigo-700">🔥 سلسلة {state.streak}</span>
        <span className={`font-mono font-bold ${remaining <= 10 ? "text-red-600" : ""}`}>
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="h-1.5 w-full rounded bg-gray-100">
        <div
          className="h-1.5 rounded bg-indigo-500 transition-all"
          style={{ width: `${(index / experiment.questions.length) * 100}%` }}
        />
      </div>

      {question && (
        <>
          <p className="font-medium">
            <span className="me-2 text-xs text-gray-500">
              {index + 1} / {experiment.questions.length}
            </span>
            {question.prompt}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {question.choices.map((choice, i) => (
              <button
                key={i}
                type="button"
                disabled={pending || remaining === 0}
                onClick={() => {
                  setFlash(null);
                  send({ questionIndex: index, choiceIndex: i });
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-right hover:bg-indigo-50 disabled:opacity-50"
              >
                {choice}
              </button>
            ))}
          </div>
        </>
      )}

      {flash && (
        <p
          role="status"
          className={flash.correct ? "text-sm font-semibold text-green-700" : "text-sm font-semibold text-red-600"}
        >
          {flash.correct ? "✓ إجابة صحيحة!" : "✗ إجابة خاطئة"}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-gray-500">تحتاج {experiment.passScore} إجابات صحيحة للفوز.</p>
    </div>
  );
}
