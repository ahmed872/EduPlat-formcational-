"use client";

import { useState } from "react";
import type { OrderingPublic } from "@/lib/experiments/definitions";
import { FeedbackBanner, useSubmitAttempt } from "./use-submit";

/** Put the steps in the right order by dragging or with the ▲/▼ buttons. */
export function OrderingRenderer({
  experimentId,
  attemptId,
  experiment,
}: {
  experimentId: string;
  attemptId: string;
  experiment: OrderingPublic;
}) {
  const [items, setItems] = useState(experiment.items);
  const [dragging, setDragging] = useState<number | null>(null);
  const { submit, feedback, pending } = useSubmitAttempt(experimentId, attemptId);

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable
            data-order-item={item.id}
            onDragStart={() => setDragging(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging !== null) move(dragging, index);
              setDragging(null);
            }}
            className="flex cursor-grab items-center justify-between gap-3 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <span>
              <span className="me-2 font-mono text-gray-500">{index + 1}.</span>
              {item.label}
            </span>
            <span className="flex gap-1">
              <button
                type="button"
                aria-label="تحريك لأعلى"
                data-move-up={item.id}
                onClick={() => move(index, index - 1)}
                className="rounded border px-2 text-xs"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label="تحريك لأسفل"
                data-move-down={item.id}
                onClick={() => move(index, index + 1)}
                className="rounded border px-2 text-xs"
              >
                ▼
              </button>
            </span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        disabled={pending}
        onClick={() => submit({ order: items.map((i) => i.id) })}
        className="w-fit rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? "جارٍ التحقق..." : "تحقق من الترتيب"}
      </button>
      <FeedbackBanner feedback={feedback} />
    </div>
  );
}
