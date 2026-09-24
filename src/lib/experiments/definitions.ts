import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ExperimentType } from "@prisma/client";
import { evaluateExpression, parseExpression } from "@/lib/experiments/expression";

/**
 * The experiment-type registry. Each type declares:
 *   - a config schema (what the teacher stores — including the answer key),
 *   - a form parser (teacher editor fields → config),
 *   - toPublic (the ONLY projection ever sent to the browser — never the key),
 *   - server-side grading (a single submission) or a move handler (step-by-step
 *     games), so completion is always the result of server validation.
 * New types are added here plus a renderer/editor on the client side.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const id = () => randomUUID().slice(0, 8);
const text = (max: number) => z.string().trim().min(1).max(max);

function lines(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function numberField(formData: FormData, name: string, fallback: number): number {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`قيمة غير صالحة للحقل: ${name}`);
  return value;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export type GradeResult = {
  passed: boolean;
  score: number;
  maxScore: number;
  message: string;
  detail?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// DRAG_AND_DROP — sort items into categories
// ---------------------------------------------------------------------------

const dragDropConfig = z
  .object({
    v: z.literal(2),
    instructions: text(2000),
    buckets: z.array(z.object({ id: z.string(), label: text(100) })).min(2).max(6),
    items: z
      .array(z.object({ id: z.string(), label: text(120), bucketId: z.string() }))
      .min(2)
      .max(20),
    passPercent: z.number().int().min(1).max(100),
  })
  .refine((c) => c.items.every((i) => c.buckets.some((b) => b.id === i.bucketId)), {
    message: "كل عنصر يجب أن ينتمي لفئة معرّفة",
  });
export type DragDropConfig = z.infer<typeof dragDropConfig>;

export type DragDropPublic = {
  kind: "DRAG_AND_DROP";
  instructions: string;
  buckets: { id: string; label: string }[];
  items: { id: string; label: string }[];
};

const dragDropSubmission = z.object({ placements: z.record(z.string(), z.string()) });

// ---------------------------------------------------------------------------
// INTERACTIVE — ordering activity (put the steps in the right sequence)
// ---------------------------------------------------------------------------

const orderingConfig = z.object({
  v: z.literal(2),
  activity: z.literal("ORDERING"),
  instructions: text(2000),
  items: z.array(z.object({ id: z.string(), label: text(160) })).min(3).max(15),
  passPercent: z.number().int().min(1).max(100),
});
export type OrderingConfig = z.infer<typeof orderingConfig>;

export type OrderingPublic = {
  kind: "ORDERING";
  instructions: string;
  items: { id: string; label: string }[];
};

const orderingSubmission = z.object({ order: z.array(z.string()) });

// ---------------------------------------------------------------------------
// MINI_GAME — timed speed round with lives and streaks, played move by move
// ---------------------------------------------------------------------------

const miniGameConfig = z
  .object({
    v: z.literal(2),
    instructions: text(2000),
    questions: z
      .array(
        z.object({
          prompt: text(300),
          choices: z.array(text(120)).min(2).max(6),
          correctIndex: z.number().int().min(0),
        }),
      )
      .min(2)
      .max(30),
    lives: z.number().int().min(1).max(5),
    timeLimitSeconds: z.number().int().min(20).max(900),
    passScore: z.number().int().min(1),
  })
  .refine((c) => c.questions.every((q) => q.correctIndex < q.choices.length), {
    message: "الإجابة الصحيحة يجب أن تكون أحد الخيارات",
  })
  .refine((c) => c.passScore <= c.questions.length, {
    message: "درجة النجاح أكبر من عدد الأسئلة",
  });
export type MiniGameConfig = z.infer<typeof miniGameConfig>;

export type MiniGamePublic = {
  kind: "MINI_GAME";
  instructions: string;
  questions: { prompt: string; choices: string[] }[];
  lives: number;
  timeLimitSeconds: number;
  passScore: number;
};

export type MiniGameState = {
  answers: number[];
  correct: number;
  streak: number;
  bestStreak: number;
  livesLeft: number;
  done: boolean;
  timedOut?: boolean;
};

const miniGameMove = z.union([
  z.object({
    questionIndex: z.number().int().min(0),
    choiceIndex: z.number().int().min(0),
  }),
  // Sent by the client when its countdown reaches zero; honoured only once
  // the time limit has really elapsed server-side.
  z.object({ timeout: z.literal(true) }),
]);
export type MiniGameMove = z.infer<typeof miniGameMove>;

/** Network slack on top of the game's own time limit (same idea as quizzes). */
const MINI_GAME_GRACE_SECONDS = 10;

// ---------------------------------------------------------------------------
// SIMULATION — template: formula explorer (variables → formula → target)
// ---------------------------------------------------------------------------

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,15}$/;

const simulationConfig = z
  .object({
    v: z.literal(2),
    template: z.literal("FORMULA_EXPLORER"),
    instructions: text(2000),
    variables: z
      .array(
        z.object({
          name: z.string().regex(VARIABLE_NAME),
          label: text(60),
          min: z.number().finite(),
          max: z.number().finite(),
          step: z.number().finite().positive(),
          default: z.number().finite(),
        }),
      )
      .min(1)
      .max(4),
    formula: text(300),
    outputLabel: text(60),
    outputUnit: z.string().trim().max(20),
    target: z.number().finite(),
    tolerance: z.number().finite().positive(),
    plotVariable: z.string(),
  })
  .superRefine((c, ctx) => {
    const names = c.variables.map((v) => v.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", message: "أسماء المتغيرات يجب ألا تتكرر" });
    }
    for (const v of c.variables) {
      if (!(v.min < v.max)) ctx.addIssue({ code: "custom", message: `المدى غير صالح للمتغير ${v.name}` });
      if (v.default < v.min || v.default > v.max) {
        ctx.addIssue({ code: "custom", message: `القيمة الابتدائية خارج المدى للمتغير ${v.name}` });
      }
    }
    if (!names.includes(c.plotVariable)) {
      ctx.addIssue({ code: "custom", message: "متغير الرسم يجب أن يكون أحد المتغيرات" });
    }
    try {
      parseExpression(c.formula, names);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
    }
  });
export type SimulationConfig = z.infer<typeof simulationConfig>;

export type SimulationPublic = {
  kind: "SIMULATION";
  instructions: string;
  variables: SimulationConfig["variables"];
  formula: string;
  outputLabel: string;
  outputUnit: string;
  target: number;
  tolerance: number;
  plotVariable: string;
};

const simulationSubmission = z.object({ values: z.record(z.string(), z.number().finite()) });

function simulationOutput(config: SimulationConfig, values: Record<string, number>): number {
  const ast = parseExpression(config.formula, config.variables.map((v) => v.name));
  return evaluateExpression(ast, values);
}

/** True when `value` is one the variable's slider can produce (min + k·step). */
function onStep(v: SimulationConfig["variables"][number], value: number): boolean {
  const k = (value - v.min) / v.step;
  return Math.abs(k - Math.round(k)) < 1e-6 || value === v.max;
}

/** Refuses a simulation whose target can't actually be reached on its slider grid. */
function assertTargetReachable(config: SimulationConfig) {
  const ast = parseExpression(config.formula, config.variables.map((v) => v.name));
  const grids = config.variables.map((v) => {
    const steps = Math.floor((v.max - v.min) / v.step + 1e-9);
    // Up to 60 step-aligned samples per variable (every step when there are fewer).
    const stride = Math.max(1, Math.ceil(steps / 60));
    const points: number[] = [];
    for (let k = 0; k <= steps; k += stride) points.push(v.min + k * v.step);
    if (points[points.length - 1] !== v.min + steps * v.step) points.push(v.min + steps * v.step);
    return points;
  });
  const values: Record<string, number> = {};
  const search = (index: number): boolean => {
    if (index === config.variables.length) {
      let out = NaN;
      try {
        out = evaluateExpression(ast, values);
      } catch {
        // e.g. division by zero at this point — not a solution
      }
      return Number.isFinite(out) && Math.abs(out - config.target) <= config.tolerance;
    }
    for (const x of grids[index]) {
      values[config.variables[index].name] = x;
      if (search(index + 1)) return true;
    }
    return false;
  };
  if (!search(0)) {
    throw new Error("لا يمكن الوصول إلى القيمة المستهدفة ضمن مدى المتغيرات — راجع الهدف أو السماحية");
  }
}

// ---------------------------------------------------------------------------
// LEGACY — the pre-registry "guided steps" checklist, kept so existing
// experiments keep working. Weakest kind: it can only verify that every step
// was acknowledged (never an empty submission).
// ---------------------------------------------------------------------------

const legacyConfig = z.object({
  instructions: z.string().optional(),
  steps: z.array(z.string()).min(1),
  embedUrl: z.string().optional(),
});
export type LegacyConfig = z.infer<typeof legacyConfig>;

export type LegacyPublic = {
  kind: "LEGACY_STEPS";
  instructions: string;
  steps: string[];
  embedUrl?: string;
};

const legacySubmission = z.object({ acknowledged: z.array(z.number().int().min(0)) });

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type PublicExperiment =
  | DragDropPublic
  | OrderingPublic
  | MiniGamePublic
  | SimulationPublic
  | LegacyPublic;

export type ResolvedExperiment =
  | { kind: "DRAG_AND_DROP"; config: DragDropConfig }
  | { kind: "ORDERING"; config: OrderingConfig }
  | { kind: "MINI_GAME"; config: MiniGameConfig }
  | { kind: "SIMULATION"; config: SimulationConfig }
  | { kind: "LEGACY_STEPS"; config: LegacyConfig };

export const EXPERIMENT_TYPE_LABELS: Record<ExperimentType, string> = {
  DRAG_AND_DROP: "سحب وإفلات (تصنيف)",
  INTERACTIVE: "نشاط تفاعلي (ترتيب الخطوات)",
  MINI_GAME: "لعبة تعليمية (جولة سرعة)",
  SIMULATION: "محاكاة (مستكشف المعادلات)",
};

/** Reads a stored experiment into its type's validated config, or null if broken. */
export function resolveExperiment(experiment: {
  type: ExperimentType;
  config: unknown;
}): ResolvedExperiment | null {
  const raw = experiment.config as { v?: number } | null;
  if (raw && raw.v === 2) {
    const parsers = {
      DRAG_AND_DROP: () => ({ kind: "DRAG_AND_DROP" as const, config: dragDropConfig.parse(raw) }),
      INTERACTIVE: () => ({ kind: "ORDERING" as const, config: orderingConfig.parse(raw) }),
      MINI_GAME: () => ({ kind: "MINI_GAME" as const, config: miniGameConfig.parse(raw) }),
      SIMULATION: () => ({ kind: "SIMULATION" as const, config: simulationConfig.parse(raw) }),
    };
    try {
      return parsers[experiment.type]();
    } catch {
      return null;
    }
  }
  const legacy = legacyConfig.safeParse(raw);
  return legacy.success ? { kind: "LEGACY_STEPS", config: legacy.data } : null;
}

/** The only view of an experiment the browser ever receives. */
export function toPublicExperiment(resolved: ResolvedExperiment): PublicExperiment {
  switch (resolved.kind) {
    case "DRAG_AND_DROP":
      return {
        kind: "DRAG_AND_DROP",
        instructions: resolved.config.instructions,
        buckets: resolved.config.buckets,
        items: shuffled(resolved.config.items.map(({ id, label }) => ({ id, label }))),
      };
    case "ORDERING": {
      const items = resolved.config.items.map(({ id, label }) => ({ id, label }));
      let scrambled = shuffled(items);
      // Never hand the student an already-solved order.
      for (let i = 0; i < 5 && scrambled.every((item, idx) => item.id === items[idx].id); i++) {
        scrambled = shuffled(items);
      }
      return { kind: "ORDERING", instructions: resolved.config.instructions, items: scrambled };
    }
    case "MINI_GAME":
      return {
        kind: "MINI_GAME",
        instructions: resolved.config.instructions,
        questions: resolved.config.questions.map(({ prompt, choices }) => ({ prompt, choices })),
        lives: resolved.config.lives,
        timeLimitSeconds: resolved.config.timeLimitSeconds,
        passScore: resolved.config.passScore,
      };
    case "SIMULATION": {
      const { v: _v, template: _t, ...rest } = resolved.config;
      void _v;
      void _t;
      return { kind: "SIMULATION", ...rest };
    }
    case "LEGACY_STEPS":
      return {
        kind: "LEGACY_STEPS",
        instructions: resolved.config.instructions ?? "",
        steps: resolved.config.steps,
        embedUrl: resolved.config.embedUrl,
      };
  }
}

/**
 * Server-side grading of a single submission. Throws on a malformed
 * submission (e.g. an empty or partial answer) — that is never a "pass".
 */
export function gradeSubmission(resolved: ResolvedExperiment, submission: unknown): GradeResult {
  switch (resolved.kind) {
    case "DRAG_AND_DROP": {
      const { placements } = dragDropSubmission.parse(submission);
      const { items, buckets, passPercent } = resolved.config;
      const bucketIds = new Set(buckets.map((b) => b.id));
      const itemIds = new Set(items.map((i) => i.id));
      const keys = Object.keys(placements);
      if (keys.length !== items.length || !keys.every((k) => itemIds.has(k))) {
        throw new Error("يجب وضع كل العناصر في فئات قبل التحقق");
      }
      if (!Object.values(placements).every((b) => bucketIds.has(b))) {
        throw new Error("فئة غير معروفة");
      }
      const score = items.filter((i) => placements[i.id] === i.bucketId).length;
      const passed = (score / items.length) * 100 >= passPercent;
      return {
        passed,
        score,
        maxScore: items.length,
        message: passed ? "أحسنت! التصنيف صحيح." : `صنّفت ${score} من ${items.length} بشكل صحيح — حاول مرة أخرى.`,
      };
    }
    case "ORDERING": {
      const { order } = orderingSubmission.parse(submission);
      const { items, passPercent } = resolved.config;
      const expected = items.map((i) => i.id);
      if (order.length !== expected.length || new Set(order).size !== order.length || !order.every((o) => expected.includes(o))) {
        throw new Error("يجب ترتيب كل العناصر قبل التحقق");
      }
      const score = order.filter((o, idx) => o === expected[idx]).length;
      const passed = (score / expected.length) * 100 >= passPercent;
      return {
        passed,
        score,
        maxScore: expected.length,
        message: passed ? "أحسنت! الترتيب صحيح." : `${score} من ${expected.length} في مكانها الصحيح — حاول مرة أخرى.`,
      };
    }
    case "SIMULATION": {
      const { values } = simulationSubmission.parse(submission);
      const { variables, target, tolerance } = resolved.config;
      const clean: Record<string, number> = {};
      for (const v of variables) {
        const value = values[v.name];
        if (typeof value !== "number" || value < v.min || value > v.max) {
          throw new Error(`قيمة ${v.label} خارج المدى المسموح`);
        }
        if (!onStep(v, value)) throw new Error(`قيمة ${v.label} غير صالحة`);
        clean[v.name] = value;
      }
      const output = simulationOutput(resolved.config, clean);
      const passed = Number.isFinite(output) && Math.abs(output - target) <= tolerance;
      return {
        passed,
        score: passed ? 1 : 0,
        maxScore: 1,
        message: passed
          ? "أحسنت! وصلت إلى القيمة المستهدفة."
          : "لم تصل إلى القيمة المستهدفة بعد — غيّر المتغيرات وحاول مرة أخرى.",
        detail: { output },
      };
    }
    case "LEGACY_STEPS": {
      const { acknowledged } = legacySubmission.parse(submission);
      const total = resolved.config.steps.length;
      const unique = new Set(acknowledged.filter((i) => i < total));
      if (unique.size !== total) {
        throw new Error("أكمل كل الخطوات أولًا لإنهاء التجربة");
      }
      return { passed: true, score: total, maxScore: total, message: "تم إنهاء التجربة." };
    }
    case "MINI_GAME":
      throw new Error("هذه اللعبة تُلعب خطوة بخطوة");
  }
}

/**
 * An open attempt stops being "live" after this long (or, for a mini game,
 * once its round's time limit plus grace has passed). A dead attempt earns
 * no study time and is replaced by a fresh one when the student restarts.
 */
export const ATTEMPT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function attemptExpired(resolved: ResolvedExperiment, startedAt: Date, now: Date): boolean {
  const age = now.getTime() - startedAt.getTime();
  if (age > ATTEMPT_MAX_AGE_MS) return true;
  if (resolved.kind === "MINI_GAME") {
    return age > (resolved.config.timeLimitSeconds + MINI_GAME_GRACE_SECONDS) * 1000;
  }
  return false;
}

export function initialMiniGameState(config: MiniGameConfig): MiniGameState {
  return { answers: [], correct: 0, streak: 0, bestStreak: 0, livesLeft: config.lives, done: false };
}

/**
 * One server-validated move in the mini game. Answers must arrive in order,
 * can't be changed once given, and nothing counts after the time limit — the
 * clock is the attempt's server-side start time, never the browser's timer.
 */
export function applyMiniGameMove(
  config: MiniGameConfig,
  state: MiniGameState,
  rawMove: unknown,
  elapsedMs: number,
): { state: MiniGameState; correct: boolean | null; correctIndex: number | null } {
  if (state.done) throw new Error("انتهت هذه الجولة");
  const timedOut = { state: { ...state, done: true, timedOut: true }, correct: null, correctIndex: null };
  if (elapsedMs > (config.timeLimitSeconds + MINI_GAME_GRACE_SECONDS) * 1000) return timedOut;
  const move = miniGameMove.parse(rawMove);
  if ("timeout" in move) {
    if (elapsedMs < config.timeLimitSeconds * 1000) throw new Error("لم ينتهِ الوقت بعد");
    return timedOut;
  }
  if (move.questionIndex !== state.answers.length) throw new Error("ترتيب الأسئلة غير صحيح");
  const question = config.questions[move.questionIndex];
  if (!question) throw new Error("سؤال غير موجود");
  if (move.choiceIndex >= question.choices.length) throw new Error("خيار غير صالح");

  const correct = move.choiceIndex === question.correctIndex;
  const streak = correct ? state.streak + 1 : 0;
  const next: MiniGameState = {
    answers: [...state.answers, move.choiceIndex],
    correct: state.correct + (correct ? 1 : 0),
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    livesLeft: state.livesLeft - (correct ? 0 : 1),
    done: false,
  };
  next.done = next.livesLeft <= 0 || next.answers.length >= config.questions.length;
  return { state: next, correct, correctIndex: question.correctIndex };
}

export function gradeMiniGame(config: MiniGameConfig, state: MiniGameState): GradeResult {
  const passed = state.correct >= config.passScore;
  return {
    passed,
    score: state.correct,
    maxScore: config.questions.length,
    message: passed
      ? `فوز! أجبت ${state.correct} إجابة صحيحة.`
      : state.timedOut
        ? "انتهى الوقت! ابدأ جولة جديدة."
        : state.livesLeft <= 0
          ? "نفدت المحاولات! ابدأ جولة جديدة."
          : `أجبت ${state.correct} فقط — تحتاج ${config.passScore}. ابدأ جولة جديدة.`,
    detail: { bestStreak: state.bestStreak },
  };
}

// ---------------------------------------------------------------------------
// Teacher editor form → validated config
// ---------------------------------------------------------------------------

function firstIssue(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "إعدادات غير صالحة";
  return (error as Error).message;
}

export function buildExperimentConfig(type: ExperimentType, formData: FormData): unknown {
  const instructions = String(formData.get("instructions") ?? "").trim();
  const passPercent = numberField(formData, "passPercent", 100);
  try {
    switch (type) {
      case "DRAG_AND_DROP": {
        const buckets = lines(formData.get("buckets")).map((label) => ({ id: id(), label }));
        const items = lines(formData.get("items")).map((line) => {
          const sep = line.lastIndexOf("|");
          if (sep === -1) throw new Error(`صيغة العنصر غير صحيحة (المطلوب: العنصر | الفئة): ${line}`);
          const label = line.slice(0, sep).trim();
          const bucketLabel = line.slice(sep + 1).trim();
          const bucket = buckets.find((b) => b.label === bucketLabel);
          if (!bucket) throw new Error(`الفئة غير معرّفة: ${bucketLabel}`);
          return { id: id(), label, bucketId: bucket.id };
        });
        return dragDropConfig.parse({ v: 2, instructions, buckets, items, passPercent });
      }
      case "INTERACTIVE": {
        const items = lines(formData.get("orderItems")).map((label) => ({ id: id(), label }));
        return orderingConfig.parse({ v: 2, activity: "ORDERING", instructions, items, passPercent });
      }
      case "MINI_GAME": {
        const questions = lines(formData.get("questions")).map((line) => {
          const parts = line.split("|").map((p) => p.trim());
          if (parts.length !== 3) {
            throw new Error(`صيغة السؤال غير صحيحة (السؤال | الخيارات | الإجابة): ${line}`);
          }
          const choices = parts[1].split(/[,،]/).map((c) => c.trim()).filter(Boolean);
          const correctIndex = choices.indexOf(parts[2]);
          if (correctIndex === -1) throw new Error(`الإجابة الصحيحة ليست ضمن الخيارات: ${line}`);
          return { prompt: parts[0], choices, correctIndex };
        });
        return miniGameConfig.parse({
          v: 2,
          instructions,
          questions,
          lives: numberField(formData, "lives", 3),
          timeLimitSeconds: numberField(formData, "timeLimitSeconds", 120),
          passScore: numberField(formData, "passScore", Math.max(1, Math.ceil(questions.length * 0.6))),
        });
      }
      case "SIMULATION": {
        const variables = lines(formData.get("variables")).map((line) => {
          const parts = line.split("|").map((p) => p.trim());
          if (parts.length !== 6) {
            throw new Error(`صيغة المتغير غير صحيحة (الاسم | التسمية | أقل | أكبر | الخطوة | الابتدائية): ${line}`);
          }
          const [name, label, min, max, step, initial] = parts;
          return { name, label, min: Number(min), max: Number(max), step: Number(step), default: Number(initial) };
        });
        const config = simulationConfig.parse({
          v: 2,
          template: "FORMULA_EXPLORER",
          instructions,
          variables,
          formula: String(formData.get("formula") ?? ""),
          outputLabel: String(formData.get("outputLabel") ?? ""),
          outputUnit: String(formData.get("outputUnit") ?? ""),
          target: numberField(formData, "target", NaN),
          tolerance: numberField(formData, "tolerance", NaN),
          plotVariable: String(formData.get("plotVariable") ?? "").trim() || variables[0]?.name,
        });
        assertTargetReachable(config);
        return config;
      }
    }
  } catch (error) {
    throw new Error(firstIssue(error));
  }
}
