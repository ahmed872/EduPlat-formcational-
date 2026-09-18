"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ExamQuestion = {
  id: string;
  type: string;
  prompt: string;
  options: unknown;
  points: number;
};

type GradedResult = {
  percentage: number | null;
  passed: boolean | null;
  status: string;
};

export function ExamRunner({
  attemptId,
  questions,
  timeLimitMinutes,
  startedAt,
}: {
  attemptId: string;
  questions: ExamQuestion[];
  timeLimitMinutes: number | null;
  startedAt: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deadline = useMemo(() => {
    if (!timeLimitMinutes) return null;
    return new Date(startedAt).getTime() + timeLimitMinutes * 60_000;
  }, [timeLimitMinutes, startedAt]);

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(
    deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null,
  );

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        handleSubmit();
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const payload = {
      answers: questions.map((q) => ({
        questionId: q.id,
        studentAnswer: answers[q.id] ?? null,
      })),
    };
    const response = await fetch(`/api/exams/${attemptId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "تعذر إرسال الإجابات");
      return;
    }
    const graded = await response.json();
    setResult(graded);
    router.refresh();
  }

  if (result) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        {result.status === "GRADED" ? (
          <p className="font-medium">
            النتيجة: {result.percentage?.toFixed(0)}% —{" "}
            {result.passed ? "ناجح" : "راسب"}
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            تم إرسال إجاباتك. بعض الأسئلة تحتاج تصحيحًا يدويًا من المعلم — ستظهر
            النتيجة النهائية بعد المراجعة.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {remainingSeconds !== null && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          الوقت المتبقي: {Math.floor(remainingSeconds / 60)}:
          {String(remainingSeconds % 60).padStart(2, "0")}
        </div>
      )}
      {questions.map((question, index) => (
        <div key={question.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-2 font-medium">
            {index + 1}. {question.prompt}
          </p>
          <QuestionInput
            question={question}
            value={answers[question.id]}
            onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
          />
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="self-start rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {submitting ? "جاري الإرسال..." : "إرسال الإجابات"}
      </button>
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: ExamQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const options = Array.isArray(question.options) ? (question.options as string[]) : [];

  if (question.type === "SINGLE_CHOICE" || question.type === "TRUE_FALSE") {
    return (
      <div className="flex flex-col gap-1">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={question.id}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (question.type === "MULTIPLE_CHOICE") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-col gap-1">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(e) => {
                if (e.target.checked) onChange([...selected, option]);
                else onChange(selected.filter((o) => o !== option));
              }}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (question.type === "MATCHING") {
    const answers = Array.isArray(value) ? (value as string[]) : options.map(() => "");
    return (
      <div className="flex flex-col gap-2">
        {options.map((option, index) => (
          <div key={option} className="flex items-center gap-2 text-sm">
            <span className="w-32 shrink-0">{option}</span>
            <input
              value={answers[index] ?? ""}
              onChange={(e) => {
                const next = [...answers];
                next[index] = e.target.value;
                onChange(next);
              }}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1"
              placeholder="الإجابة المطابقة"
            />
          </div>
        ))}
      </div>
    );
  }

  // SHORT_ANSWER / ESSAY — free text, graded manually later.
  return (
    <textarea
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      rows={question.type === "ESSAY" ? 5 : 2}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
    />
  );
}
