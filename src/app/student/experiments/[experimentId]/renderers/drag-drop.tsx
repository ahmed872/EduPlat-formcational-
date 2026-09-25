"use client";

import { useState } from "react";
import type { DragDropPublic } from "@/lib/experiments/definitions";
import { FeedbackBanner, useSubmitAttempt } from "./use-submit";

/**
 * Sort items into categories by dragging them (mouse) or by tapping an item
 * then a category (touch / keyboard) — the answer key never reaches the
 * browser; the server grades the final placements.
 */
export function DragDropRenderer({
  experimentId,
  attemptId,
  experiment,
}: {
  experimentId: string;
  attemptId: string;
  experiment: DragDropPublic;
}) {
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const { submit, feedback, pending } = useSubmitAttempt(experimentId, attemptId);

  function place(itemId: string, bucketId: string | null) {
    setPlacements((prev) => {
      const next = { ...prev };
      if (bucketId) next[itemId] = bucketId;
      else delete next[itemId];
      return next;
    });
    setSelected(null);
  }

  const unplaced = experiment.items.filter((item) => !placements[item.id]);
  const allPlaced = unplaced.length === 0;

  function Item({ id, label }: { id: string; label: string }) {
    return (
      <button
        type="button"
        draggable
        data-item-id={id}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
        onClick={() => setSelected(selected === id ? null : id)}
        className={`cursor-grab rounded-md border px-3 py-1.5 text-sm ${
          selected === id ? "border-indigo-600 bg-indigo-50" : "border-gray-300 bg-white"
        }`}
      >
        {label}
      </button>
    );
  }

  function dropProps(bucketId: string | null) {
    return {
      onDragOver: (e: React.DragEvent) => e.preventDefault(),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const itemId = e.dataTransfer.getData("text/plain");
        if (itemId) place(itemId, bucketId);
      },
      onClick: () => {
        if (selected) place(selected, bucketId);
      },
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        {...dropProps(null)}
        data-pool
        className="flex min-h-14 flex-wrap gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3"
      >
        {unplaced.length === 0 ? (
          <span className="text-xs text-gray-500">كل العناصر موزّعة</span>
        ) : (
          unplaced.map((item) => <Item key={item.id} {...item} />)
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {experiment.buckets.map((bucket) => (
          <div
            key={bucket.id}
            {...dropProps(bucket.id)}
            data-bucket-id={bucket.id}
            className="min-h-28 rounded-lg border-2 border-indigo-100 bg-white p-3"
          >
            <p className="mb-2 text-sm font-semibold text-indigo-700">{bucket.label}</p>
            <div className="flex flex-wrap gap-2">
              {experiment.items
                .filter((item) => placements[item.id] === bucket.id)
                .map((item) => (
                  <Item key={item.id} {...item} />
                ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        اسحب كل عنصر إلى فئته، أو اضغط العنصر ثم الفئة. اضغط المنطقة العلوية لإعادة عنصر محدد.
      </p>

      <button
        type="button"
        disabled={!allPlaced || pending}
        onClick={() => submit({ placements })}
        className="w-fit rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? "جارٍ التحقق..." : "تحقق من الإجابة"}
      </button>
      <FeedbackBanner feedback={feedback} />
    </div>
  );
}
