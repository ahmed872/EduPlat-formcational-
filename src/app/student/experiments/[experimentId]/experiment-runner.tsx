"use client";

import { useEffect, useRef } from "react";
import type { MiniGameState, PublicExperiment } from "@/lib/experiments/definitions";
import { DragDropRenderer } from "./renderers/drag-drop";
import { OrderingRenderer } from "./renderers/ordering";
import { MiniGameRenderer } from "./renderers/mini-game";
import { SimulationRenderer } from "./renderers/simulation";
import { LegacyStepsRenderer } from "./renderers/legacy-steps";

const HEARTBEAT_INTERVAL_MS = 10_000;
/** No interaction for this long = idle; idle time is never reported. */
const IDLE_AFTER_MS = 30_000;

/**
 * Reports EXERCISE study time only while the student is genuinely using the
 * experiment: the tab must be visible and there must have been a pointer,
 * key or input interaction within the idle window. The server independently
 * caps each credited gap and requires an open attempt (see study-time.ts),
 * so this is a best-effort signal, never trusted as proof on its own.
 */
function useExerciseHeartbeat(experimentId: string) {
  const lastInteraction = useRef(0);

  useEffect(() => {
    const mark = () => {
      lastInteraction.current = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "input", "dragstart", "drop"] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastInteraction.current > IDLE_AFTER_MS) return;
      fetch("/api/study/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "EXERCISE", refId: experimentId }),
      }).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      clearInterval(interval);
    };
  }, [experimentId]);
}

export function ExperimentRunner({
  experimentId,
  attemptId,
  startedAt,
  initialState,
  experiment,
}: {
  experimentId: string;
  attemptId: string;
  startedAt: string;
  initialState: MiniGameState | null;
  experiment: PublicExperiment;
}) {
  useExerciseHeartbeat(experimentId);
  const common = { experimentId, attemptId };

  switch (experiment.kind) {
    case "DRAG_AND_DROP":
      return <DragDropRenderer {...common} experiment={experiment} />;
    case "ORDERING":
      return <OrderingRenderer {...common} experiment={experiment} />;
    case "MINI_GAME":
      return (
        <MiniGameRenderer {...common} experiment={experiment} startedAt={startedAt} initialState={initialState} />
      );
    case "SIMULATION":
      return <SimulationRenderer {...common} experiment={experiment} />;
    case "LEGACY_STEPS":
      return <LegacyStepsRenderer {...common} experiment={experiment} />;
  }
}
