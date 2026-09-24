/**
 * A tiny, closed arithmetic language for simulation formulas, e.g.
 * `v * t - 0.5 * g * t ^ 2` or `sqrt(a ^ 2 + b ^ 2)`. It never uses
 * eval/Function: it tokenizes and parses into an AST that only knows
 * numbers, declared variables, + - * / ^, unary minus, parentheses and a
 * fixed list of math functions. The same evaluator runs in the browser (live
 * visualization) and on the server (grading), so the two can't disagree.
 */

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "neg"; arg: Expr }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Expr; right: Expr }
  | { kind: "call"; fn: FunctionName; arg: Expr };

const FUNCTIONS = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
} as const;
type FunctionName = keyof typeof FUNCTIONS;

const MAX_LENGTH = 300;

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" | "(" | ")" };

function tokenize(source: string): Token[] {
  if (source.length > MAX_LENGTH) throw new Error("المعادلة طويلة جدًا");
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(source.slice(i));
      if (!match) throw new Error(`رقم غير صالح عند الموضع ${i + 1}`);
      tokens.push({ t: "num", v: Number(match[0]) });
      i += match[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ t: "id", v: match[0] });
      i += match[0].length;
    } else if ("+-*/^()".includes(ch)) {
      tokens.push({ t: "op", v: ch as "+" });
      i++;
    } else {
      throw new Error(`رمز غير مسموح في المعادلة: ${ch}`);
    }
  }
  return tokens;
}

/** Parses a formula, allowing only the given variable names. */
export function parseExpression(source: string, allowedVariables: readonly string[]): Expr {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;

  function expression(): Expr {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { v: "+" | "-" }).v;
      left = { kind: "bin", op, left, right: term() };
    }
    return left;
  }
  function term(): Expr {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = (tokens[pos++] as { v: "*" | "/" }).v;
      left = { kind: "bin", op, left, right: unary() };
    }
    return left;
  }
  function unary(): Expr {
    if (isOp("-")) {
      pos++;
      return { kind: "neg", arg: unary() };
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  }
  function power(): Expr {
    const base = primary();
    if (isOp("^")) {
      pos++;
      return { kind: "bin", op: "^", left: base, right: unary() };
    }
    return base;
  }
  function primary(): Expr {
    const token = tokens[pos++];
    if (!token) throw new Error("المعادلة غير مكتملة");
    if (token.t === "num") return { kind: "num", value: token.v };
    if (token.t === "id") {
      if (isOp("(")) {
        if (!Object.hasOwn(FUNCTIONS, token.v)) throw new Error(`دالة غير معروفة: ${token.v}`);
        pos++;
        const arg = expression();
        if (!isOp(")")) throw new Error("قوس غير مغلق");
        pos++;
        return { kind: "call", fn: token.v as FunctionName, arg };
      }
      if (!allowedVariables.includes(token.v)) throw new Error(`متغير غير معرّف: ${token.v}`);
      return { kind: "var", name: token.v };
    }
    if (token.v === "(") {
      const inner = expression();
      if (!isOp(")")) throw new Error("قوس غير مغلق");
      pos++;
      return inner;
    }
    throw new Error(`رمز غير متوقع: ${token.v}`);
  }

  const ast = expression();
  if (pos !== tokens.length) throw new Error("صيغة المعادلة غير صحيحة");
  return ast;
}

export function evaluateExpression(expr: Expr, values: Record<string, number>): number {
  switch (expr.kind) {
    case "num":
      return expr.value;
    case "var": {
      const value = values[expr.name];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`قيمة غير صالحة للمتغير ${expr.name}`);
      }
      return value;
    }
    case "neg":
      return -evaluateExpression(expr.arg, values);
    case "call":
      return FUNCTIONS[expr.fn](evaluateExpression(expr.arg, values));
    case "bin": {
      const a = evaluateExpression(expr.left, values);
      const b = evaluateExpression(expr.right, values);
      switch (expr.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return a ** b;
      }
    }
  }
}
