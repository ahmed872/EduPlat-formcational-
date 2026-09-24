"use client";

import { useMemo, useState } from "react";
import type { SimulationPublic } from "@/lib/experiments/definitions";
import { evaluateExpression, parseExpression } from "@/lib/experiments/expression";
import { FeedbackBanner, useSubmitAttempt } from "./use-submit";

const WIDTH = 520;
const HEIGHT = 240;
const PAD = 36;
const SAMPLES = 80;

function format(n: number) {
  return Number.isFinite(n) ? Number(n.toFixed(3)).toString() : "—";
}

/**
 * Formula-explorer simulation: sliders drive the variables, the output is
 * recomputed live and plotted as a curve over the chosen variable with the
 * target band drawn in. The server recomputes the output from the submitted
 * values with the same evaluator to decide whether the target was reached.
 */
export function SimulationRenderer({
  experimentId,
  attemptId,
  experiment,
}: {
  experimentId: string;
  attemptId: string;
  experiment: SimulationPublic;
}) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(experiment.variables.map((v) => [v.name, v.default])),
  );
  const { submit, feedback, pending } = useSubmitAttempt(experimentId, attemptId);

  const ast = useMemo(
    () => parseExpression(experiment.formula, experiment.variables.map((v) => v.name)),
    [experiment.formula, experiment.variables],
  );
  const output = useMemo(() => {
    try {
      return evaluateExpression(ast, values);
    } catch {
      return NaN;
    }
  }, [ast, values]);

  const plotVar = experiment.variables.find((v) => v.name === experiment.plotVariable)!;
  const curve = useMemo(() => {
    return Array.from({ length: SAMPLES }, (_, i) => {
      const x = plotVar.min + ((plotVar.max - plotVar.min) * i) / (SAMPLES - 1);
      let y = NaN;
      try {
        y = evaluateExpression(ast, { ...values, [plotVar.name]: x });
      } catch {
        // leave NaN; the point is skipped
      }
      return { x, y };
    });
  }, [ast, values, plotVar]);

  const finiteYs = curve.map((p) => p.y).filter(Number.isFinite);
  const low = experiment.target - experiment.tolerance;
  const high = experiment.target + experiment.tolerance;
  const yMin = Math.min(...finiteYs, low);
  const yMax = Math.max(...finiteYs, high);
  const ySpan = yMax - yMin || 1;
  const sx = (x: number) => PAD + ((x - plotVar.min) / (plotVar.max - plotVar.min)) * (WIDTH - 2 * PAD);
  const sy = (y: number) => HEIGHT - PAD - ((y - yMin) / ySpan) * (HEIGHT - 2 * PAD);
  const path = curve
    .filter((p) => Number.isFinite(p.y))
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(" ");
  const onTarget = Number.isFinite(output) && Math.abs(output - experiment.target) <= experiment.tolerance;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {experiment.variables.map((v) => (
          <label key={v.name} className="flex flex-col gap-1 rounded-md border border-gray-200 bg-white p-3">
            <span className="flex justify-between text-sm">
              <span>{v.label}</span>
              <span className="font-mono">{format(values[v.name])}</span>
            </span>
            <input
              type="range"
              name={v.name}
              data-variable={v.name}
              min={v.min}
              max={v.max}
              step={v.step}
              value={values[v.name]}
              onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: Number(e.target.value) }))}
            />
          </label>
        ))}
      </div>

      <div
        className={`rounded-md border p-3 text-center ${onTarget ? "border-green-300 bg-green-50" : "border-gray-200 bg-white"}`}
      >
        <span className="text-sm text-gray-600">{experiment.outputLabel}: </span>
        <span className="font-mono text-lg font-bold" data-testid="simulation-output">
          {format(output)} {experiment.outputUnit}
        </span>
        <span className="ms-3 text-xs text-gray-500">
          الهدف: {format(experiment.target)} ± {format(experiment.tolerance)} {experiment.outputUnit}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full rounded-md border border-gray-200 bg-white"
        role="img"
        aria-label={`${experiment.outputLabel} مقابل ${plotVar.label}`}
      >
        <rect x={PAD} y={sy(high)} width={WIDTH - 2 * PAD} height={Math.max(1, sy(low) - sy(high))} fill="#dcfce7" />
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} stroke="#9ca3af" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={HEIGHT - PAD} stroke="#9ca3af" />
        <path d={path} fill="none" stroke="#4f46e5" strokeWidth={2} />
        {Number.isFinite(output) && (
          <circle cx={sx(values[plotVar.name])} cy={sy(output)} r={6} fill={onTarget ? "#16a34a" : "#dc2626"} />
        )}
        <text x={WIDTH / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={12} fill="#374151">
          {plotVar.label}
        </text>
        <text x={PAD} y={PAD - 10} fontSize={11} fill="#374151">
          {format(yMax)}
        </text>
        <text x={PAD} y={HEIGHT - PAD + 14} fontSize={11} fill="#374151">
          {format(yMin)}
        </text>
      </svg>

      <button
        type="button"
        disabled={pending}
        onClick={() => submit({ values })}
        className="w-fit rounded-md bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? "جارٍ التحقق..." : "تحقق من النتيجة"}
      </button>
      <FeedbackBanner feedback={feedback} />
    </div>
  );
}
