"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Exercises the real access-control + watch-session + study-time backend
 * without a real media file wired up yet (see the notice on the page). A
 * production build swaps this control surface for an actual <video>/HLS
 * player bound to the same play/pause/timeupdate events.
 */
export function WatchSessionPlayer({
  videoId,
  durationSeconds,
  viewsUsed,
  viewLimit,
}: {
  videoId: string;
  durationSeconds: number;
  viewsUsed: number;
  viewLimit: number | null;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [watchedSeconds, setWatchedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleStart() {
    setError(null);
    const response = await fetch("/api/watch-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "تعذر بدء جلسة المشاهدة");
      return;
    }
    const session = await response.json();
    setSessionId(session.id);
    setPlaying(true);
    startTicking(session.id);
  }

  function startTicking(activeSessionId: string) {
    intervalRef.current = setInterval(async () => {
      // Only send heartbeats while the tab is actually visible.
      if (document.visibilityState !== "visible") return;

      await fetch("/api/study/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "VIDEO", refId: videoId }),
      });

      setWatchedSeconds((prev) => {
        const next = Math.min(durationSeconds, prev + 5);
        fetch(`/api/watch-sessions/${activeSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            watchedSeconds: next,
            videoDurationSeconds: durationSeconds,
          }),
        }).catch(() => {});
        return next;
      });
    }, 5000);
  }

  function handlePauseToggle() {
    setPlaying((prev) => {
      const next = !prev;
      if (!next && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else if (next && sessionId) {
        startTicking(sessionId);
      }
      return next;
    });
  }

  const percent = Math.min(100, Math.round((watchedSeconds / durationSeconds) * 100));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between text-sm text-gray-600">
        <span>
          المشاهدات المستهلكة: {viewsUsed}
          {viewLimit ? ` / ${viewLimit}` : " (بدون حد — فيديو مجاني)"}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-4 flex gap-3">
        {!sessionId ? (
          <button
            onClick={handleStart}
            className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            بدء المشاهدة
          </button>
        ) : (
          <button
            onClick={handlePauseToggle}
            className="rounded-md border border-gray-300 px-4 py-2 hover:bg-gray-50"
          >
            {playing ? "إيقاف مؤقت" : "استئناف"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
