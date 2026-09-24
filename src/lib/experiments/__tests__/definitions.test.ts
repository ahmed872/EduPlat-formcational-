import { describe, expect, it } from "vitest";
import {
  applyMiniGameMove,
  buildExperimentConfig,
  gradeSubmission,
  initialMiniGameState,
  resolveExperiment,
  toPublicExperiment,
  type MiniGameConfig,
  type ResolvedExperiment,
} from "@/lib/experiments/definitions";
import { evaluateExpression, parseExpression } from "@/lib/experiments/expression";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

function build(type: Parameters<typeof buildExperimentConfig>[0], fields: Record<string, string>) {
  const config = buildExperimentConfig(type, form(fields));
  const resolved = resolveExperiment({ type, config });
  if (!resolved) throw new Error("did not resolve");
  return { config, resolved };
}

const dragDrop = () =>
  build("DRAG_AND_DROP", {
    instructions: "صنّف",
    buckets: "فلزات\nلافلزات",
    items: "الحديد | فلزات\nالنحاس | فلزات\nالكبريت | لافلزات",
  });

const ordering = () => build("INTERACTIVE", { instructions: "رتّب", orderItems: "أ\nب\nج\nد" });

const miniGame = () =>
  build("MINI_GAME", {
    instructions: "العب",
    questions: "1+1 | 1، 2 | 2\n2+2 | 4، 5 | 4\n3+3 | 6، 7 | 6",
    lives: "2",
    timeLimitSeconds: "60",
    passScore: "2",
  });

const simulation = () =>
  build("SIMULATION", {
    instructions: "اضبط القوة",
    variables: "m | الكتلة | 1 | 10 | 1 | 2\na | العجلة | 0 | 10 | 0.5 | 1",
    formula: "m * a",
    outputLabel: "القوة",
    outputUnit: "N",
    target: "20",
    tolerance: "0.5",
    plotVariable: "a",
  });

describe("expression evaluator", () => {
  const ev = (src: string, vars: Record<string, number> = {}) =>
    evaluateExpression(parseExpression(src, Object.keys(vars)), vars);

  it("respects precedence, unary minus and right-associative power", () => {
    expect(ev("2 + 3 * 4")).toBe(14);
    expect(ev("(2 + 3) * 4")).toBe(20);
    expect(ev("-2 ^ 2")).toBe(-4);
    expect(ev("2 ^ 3 ^ 2")).toBe(512);
    expect(ev("v * t - 0.5 * g * t ^ 2", { v: 10, t: 2, g: 10 })).toBe(0);
    expect(ev("sqrt(a ^ 2 + b ^ 2)", { a: 3, b: 4 })).toBe(5);
  });

  it.each([
    ["process.exit()"],
    ["constructor(1)"],
    ["toString(1)"],
    ["__proto__"],
    ["x; y"],
    ["alert`1`"],
    ["a[0]"],
    ["2 +"],
    ["(2"],
    ["1".repeat(400)],
  ])("rejects %s", (src) => {
    expect(() => parseExpression(src, ["x"])).toThrow();
  });

  it("rejects undeclared variables", () => {
    expect(() => parseExpression("m * b", ["m"])).toThrow("b");
  });
});

describe("public projection never contains the answer key", () => {
  it.each([
    ["drag & drop", dragDrop, ["bucketId", "passPercent"]],
    ["ordering", ordering, ["passPercent"]],
    ["mini game", miniGame, ["correctIndex"]],
  ] as const)("%s", (_label, make, forbidden) => {
    const { resolved } = make();
    const json = JSON.stringify(toPublicExperiment(resolved));
    for (const key of forbidden) expect(json).not.toContain(key);
  });

  it("drag & drop items carry no bucket", () => {
    const pub = toPublicExperiment(dragDrop().resolved);
    if (pub.kind !== "DRAG_AND_DROP") throw new Error();
    for (const item of pub.items) expect(Object.keys(item).sort()).toEqual(["id", "label"]);
  });

  it("ordering is never handed out already solved", () => {
    const { resolved } = build("INTERACTIVE", { instructions: "رتّب", orderItems: "أ\nب\nج" });
    if (resolved.kind !== "ORDERING") throw new Error();
    const solved = resolved.config.items.map((i) => i.id).join();
    for (let i = 0; i < 50; i++) {
      const pub = toPublicExperiment(resolved);
      if (pub.kind !== "ORDERING") throw new Error();
      expect(pub.items.map((x) => x.id).join()).not.toBe(solved);
    }
  });
});

describe("drag & drop grading", () => {
  function placements(resolved: ResolvedExperiment, correct: boolean) {
    if (resolved.kind !== "DRAG_AND_DROP") throw new Error();
    const [b0, b1] = resolved.config.buckets;
    return Object.fromEntries(
      resolved.config.items.map((i) => [i.id, correct ? i.bucketId : i.bucketId === b0.id ? b1.id : b0.id]),
    );
  }

  it("passes a correct sort and fails a wrong one", () => {
    const { resolved } = dragDrop();
    expect(gradeSubmission(resolved, { placements: placements(resolved, true) }).passed).toBe(true);
    const wrong = gradeSubmission(resolved, { placements: placements(resolved, false) });
    expect(wrong.passed).toBe(false);
    expect(wrong.score).toBe(0);
  });

  it("rejects empty, partial and unknown-bucket submissions", () => {
    const { resolved } = dragDrop();
    expect(() => gradeSubmission(resolved, [])).toThrow();
    expect(() => gradeSubmission(resolved, { placements: {} })).toThrow();
    const full = placements(resolved, true);
    const [first] = Object.keys(full);
    expect(() => gradeSubmission(resolved, { placements: { [first]: full[first] } })).toThrow();
    expect(() => gradeSubmission(resolved, { placements: { ...full, [first]: "nope" } })).toThrow();
  });
});

describe("simulation grading", () => {
  it("recomputes the output on the server", () => {
    const { resolved } = simulation();
    expect(gradeSubmission(resolved, { values: { m: 2, a: 10 } }).passed).toBe(true);
    const miss = gradeSubmission(resolved, { values: { m: 2, a: 1 } });
    expect(miss.passed).toBe(false);
    expect(miss.detail).toEqual({ output: 2 });
  });

  it("rejects missing, out-of-range and off-step values", () => {
    const { resolved } = simulation();
    expect(() => gradeSubmission(resolved, { values: { m: 2 } })).toThrow();
    expect(() => gradeSubmission(resolved, { values: { m: 40, a: 0.5 } })).toThrow();
    expect(() => gradeSubmission(resolved, { values: { m: 2.5, a: 8 } })).toThrow();
    expect(() => gradeSubmission(resolved, [])).toThrow();
  });

  it("refuses to save a simulation whose target is unreachable", () => {
    expect(() =>
      build("SIMULATION", {
        instructions: "x",
        variables: "m | الكتلة | 1 | 10 | 1 | 2",
        formula: "m * 2",
        outputLabel: "y",
        target: "1000",
        tolerance: "0.5",
      }),
    ).toThrow("لا يمكن الوصول");
  });

  it("refuses a formula that uses an undeclared variable", () => {
    expect(() =>
      build("SIMULATION", {
        instructions: "x",
        variables: "m | الكتلة | 1 | 10 | 1 | 2",
        formula: "m * g",
        outputLabel: "y",
        target: "2",
        tolerance: "0.5",
      }),
    ).toThrow();
  });
});

describe("teacher editor parsing", () => {
  it("reports a clear error for a line in the wrong format", () => {
    expect(() =>
      buildExperimentConfig("DRAG_AND_DROP", form({ instructions: "x", buckets: "أ\nب", items: "بدون فئة" })),
    ).toThrow("صيغة العنصر");
    expect(() =>
      buildExperimentConfig("MINI_GAME", form({ instructions: "x", questions: "س | أ، ب | ج\nس2 | أ، ب | أ" })),
    ).toThrow("ليست ضمن الخيارات");
  });

  it("rejects too few items", () => {
    expect(() => buildExperimentConfig("INTERACTIVE", form({ instructions: "x", orderItems: "أ" }))).toThrow();
  });
});

describe("mini game rules", () => {
  const config = () => {
    const { resolved } = miniGame();
    if (resolved.kind !== "MINI_GAME") throw new Error();
    return resolved.config as MiniGameConfig;
  };

  it("tracks streaks and lives", () => {
    const c = config();
    let s = initialMiniGameState(c);
    s = applyMiniGameMove(c, s, { questionIndex: 0, choiceIndex: 1 }, 1000).state;
    s = applyMiniGameMove(c, s, { questionIndex: 1, choiceIndex: 0 }, 2000).state;
    expect(s.streak).toBe(2);
    s = applyMiniGameMove(c, s, { questionIndex: 2, choiceIndex: 1 }, 3000).state;
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(2);
    expect(s.livesLeft).toBe(1);
    expect(s.done).toBe(true);
  });

  it("allows a small grace period but nothing beyond it", () => {
    const c = config();
    const s = initialMiniGameState(c);
    expect(applyMiniGameMove(c, s, { questionIndex: 0, choiceIndex: 1 }, 65_000).correct).toBe(true);
    expect(applyMiniGameMove(c, s, { questionIndex: 0, choiceIndex: 1 }, 71_000).state.timedOut).toBe(true);
  });
});

describe("legacy experiments", () => {
  it("still resolve and require every step to be acknowledged", () => {
    const resolved = resolveExperiment({ type: "INTERACTIVE", config: { instructions: "x", steps: ["a", "b"] } });
    expect(resolved?.kind).toBe("LEGACY_STEPS");
    expect(() => gradeSubmission(resolved!, { acknowledged: [] })).toThrow();
    expect(() => gradeSubmission(resolved!, { acknowledged: [0, 0] })).toThrow();
    expect(gradeSubmission(resolved!, { acknowledged: [0, 1] }).passed).toBe(true);
  });

  it("a config without steps does not resolve", () => {
    expect(resolveExperiment({ type: "INTERACTIVE", config: { instructions: "x" } })).toBeNull();
  });
});
