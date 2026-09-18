"use client";

import { useEffect, useRef, useState } from "react";

const HEARTBEAT_INTERVAL_MS = 10_000;
const PROGRESS_SAVE_INTERVAL_MS = 5_000;

type Chapter = { id: string; title: string; timestampSeconds: number };
type NoteOrBookmark = { id: string; timestampSeconds: number; label: string };

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/**
 * A real HTML5 player against the private, signed-URL-authorized stream
 * route (src/app/api/stream/[videoId]/route.ts). Heartbeats and watch
 * progress are only sent while the video element is actually playing AND
 * the tab is visible — pausing, backgrounding, or navigating away stops
 * both immediately (see src/lib/business/study-time.ts /
 * video-access.ts for the server-side rules this feeds).
 */
export function VideoPlayer({
  videoId,
  durationSeconds,
  viewsUsed,
  viewLimit,
  resumeFromSeconds,
  watermarkLabel,
  chapters,
  initialNotes,
  initialBookmarks,
}: {
  videoId: string;
  durationSeconds: number;
  viewsUsed: number;
  viewLimit: number | null;
  resumeFromSeconds: number;
  watermarkLabel: string;
  chapters: Chapter[];
  initialNotes: NoteOrBookmark[];
  initialBookmarks: NoteOrBookmark[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [watermarkPos, setWatermarkPos] = useState({ top: "10%", left: "10%" });
  const [notes, setNotes] = useState(initialNotes);
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const urlResponse = await fetch("/api/playback-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (!urlResponse.ok) {
        const data = await urlResponse.json().catch(() => ({}));
        if (!cancelled) setError(data.error ?? "تعذر تجهيز رابط التشغيل");
        return;
      }
      const { url } = await urlResponse.json();

      const sessionResponse = await fetch("/api/watch-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (!sessionResponse.ok) {
        const data = await sessionResponse.json().catch(() => ({}));
        if (!cancelled) setError(data.error ?? "تعذر بدء جلسة المشاهدة");
        return;
      }
      const watchSession = await sessionResponse.json();
      if (cancelled) return;
      sessionIdRef.current = watchSession.id;
      setPlaybackUrl(url);
    }

    setup();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    // Jitter the watermark position every 20s so a screen recording can't
    // simply crop it out at a fixed spot. This is a deterrent, not a
    // cryptographic protection — see SECURITY.md.
    const id = setInterval(() => {
      setWatermarkPos({
        top: `${10 + Math.random() * 70}%`,
        left: `${10 + Math.random() * 70}%`,
      });
    }, 20_000);
    return () => clearInterval(id);
  }, []);

  function clearTimers() {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }

  function handlePlay() {
    if (heartbeatIntervalRef.current || progressIntervalRef.current) return;

    heartbeatIntervalRef.current = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/study/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "VIDEO", refId: videoId }),
      }).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    progressIntervalRef.current = setInterval(() => {
      const el = videoRef.current;
      const sessionId = sessionIdRef.current;
      if (!el || !sessionId || document.visibilityState !== "visible") return;
      fetch(`/api/watch-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watchedSeconds: Math.floor(el.currentTime),
          videoDurationSeconds: Math.floor(el.duration || durationSeconds),
        }),
      }).catch(() => {});
    }, PROGRESS_SAVE_INTERVAL_MS);
  }

  function handlePauseOrEnd() {
    clearTimers();
  }

  useEffect(() => clearTimers, []);

  function seekTo(seconds: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
    }
  }

  async function addBookmark() {
    const timestampSeconds = Math.floor(videoRef.current?.currentTime ?? 0);
    const response = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, timestampSeconds }),
    });
    if (response.ok) {
      const bookmark = await response.json();
      setBookmarks((prev) => [...prev, { id: bookmark.id, timestampSeconds, label: "" }]);
    }
  }

  async function deleteBookmark(id: string) {
    await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }

  async function addNote() {
    if (!noteDraft.trim()) return;
    const timestampSeconds = Math.floor(videoRef.current?.currentTime ?? 0);
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, timestampSeconds, content: noteDraft.trim() }),
    });
    if (response.ok) {
      const note = await response.json();
      setNotes((prev) => [...prev, { id: note.id, timestampSeconds, label: noteDraft.trim() }]);
      setNoteDraft("");
    }
  }

  async function deleteNote(id: string) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-gray-200 bg-black">
        <div className="flex items-center justify-between bg-gray-900 px-3 py-1.5 text-xs text-gray-300">
          <span>
            المشاهدات: {viewsUsed}
            {viewLimit ? ` / ${viewLimit}` : " (بدون حد)"}
          </span>
        </div>
        <div className="relative">
          {playbackUrl ? (
            <video
              ref={videoRef}
              src={playbackUrl}
              controls
              className="aspect-video w-full"
              onPlay={handlePlay}
              onPause={handlePauseOrEnd}
              onEnded={handlePauseOrEnd}
              onLoadedMetadata={() => {
                if (videoRef.current && resumeFromSeconds > 0) {
                  videoRef.current.currentTime = resumeFromSeconds;
                }
              }}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center text-sm text-gray-400">
              جاري تجهيز الفيديو...
            </div>
          )}
          {playbackUrl && (
            <div
              className="pointer-events-none absolute select-none rounded bg-black/30 px-2 py-1 text-xs text-white/70"
              style={watermarkPos}
            >
              {watermarkLabel}
            </div>
          )}
        </div>
      </div>

      {chapters.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">فصول الفيديو</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                <button
                  onClick={() => seekTo(chapter.timestampSeconds)}
                  className="flex w-full justify-between rounded px-1 py-0.5 text-right hover:bg-gray-50"
                >
                  <span>{chapter.title}</span>
                  <span className="text-gray-500">{formatTime(chapter.timestampSeconds)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">اللحظات المحفوظة</h2>
            <button
              onClick={addBookmark}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
            >
              احفظ اللحظة الحالية
            </button>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {bookmarks.map((bookmark) => (
              <li key={bookmark.id} className="flex items-center justify-between">
                <button
                  onClick={() => seekTo(bookmark.timestampSeconds)}
                  className="text-indigo-600 hover:underline"
                >
                  {formatTime(bookmark.timestampSeconds)}
                </button>
                <button
                  onClick={() => deleteBookmark(bookmark.id)}
                  className="text-xs text-red-500 hover:underline"
                >
                  حذف
                </button>
              </li>
            ))}
            {bookmarks.length === 0 && (
              <li className="text-xs text-gray-400">لا توجد لحظات محفوظة بعد.</li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">ملاحظاتي الخاصة</h2>
          <div className="mb-2 flex gap-2">
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="اكتب ملاحظة عند هذه اللحظة"
              className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
            />
            <button
              onClick={addNote}
              className="rounded-md bg-gray-800 px-3 py-1 text-xs text-white hover:bg-gray-900"
            >
              إضافة
            </button>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start justify-between gap-2">
                <button
                  onClick={() => seekTo(note.timestampSeconds)}
                  className="text-right text-gray-700 hover:underline"
                >
                  <span className="text-xs text-indigo-600">
                    {formatTime(note.timestampSeconds)}
                  </span>{" "}
                  — {note.label}
                </button>
                <button
                  onClick={() => deleteNote(note.id)}
                  className="shrink-0 text-xs text-red-500 hover:underline"
                >
                  حذف
                </button>
              </li>
            ))}
            {notes.length === 0 && (
              <li className="text-xs text-gray-400">لا توجد ملاحظات بعد.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
