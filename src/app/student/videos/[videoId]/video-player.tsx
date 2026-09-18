"use client";

import { useEffect, useRef, useState } from "react";

const HEARTBEAT_INTERVAL_MS = 10_000;
const PROGRESS_SAVE_INTERVAL_MS = 5_000;

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
}: {
  videoId: string;
  durationSeconds: number;
  viewsUsed: number;
  viewLimit: number | null;
  resumeFromSeconds: number;
  watermarkLabel: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [watermarkPos, setWatermarkPos] = useState({ top: "10%", left: "10%" });

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

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
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
  );
}
