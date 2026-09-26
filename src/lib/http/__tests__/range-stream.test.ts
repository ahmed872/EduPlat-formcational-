import { describe, expect, it } from "vitest";
import { resolveRange } from "@/lib/http/range-stream";

describe("resolveRange (RFC 9110 byte ranges)", () => {
  it("serves ordinary and open-ended ranges", () => {
    expect(resolveRange("0", "99", 1000)).toEqual({ start: 0, end: 99 });
    expect(resolveRange("900", "", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("regression: clamps an end past the last byte instead of refusing (a player's final chunk)", () => {
    expect(resolveRange("0", "1023", 42)).toEqual({ start: 0, end: 41 });
    expect(resolveRange("990", "2047", 1000)).toEqual({ start: 990, end: 999 });
  });

  it("regression: a suffix range means the LAST n bytes", () => {
    expect(resolveRange("", "100", 1000)).toEqual({ start: 900, end: 999 });
    expect(resolveRange("", "5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("refuses unsatisfiable ranges", () => {
    expect(resolveRange("1000", "", 1000)).toBeNull();
    expect(resolveRange("1000", "1100", 1000)).toBeNull();
    expect(resolveRange("50", "10", 1000)).toBeNull();
    expect(resolveRange("", "0", 1000)).toBeNull();
    expect(resolveRange("", "", 1000)).toBeNull();
    expect(resolveRange("0", "0", 0)).toBeNull();
  });
});
