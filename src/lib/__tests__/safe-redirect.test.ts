import { describe, expect, it } from "vitest";
import { safeCallbackPath } from "@/lib/safe-redirect";

describe("safeCallbackPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeCallbackPath("/student/videos/abc?t=1")).toBe("/student/videos/abc?t=1");
    expect(safeCallbackPath("/")).toBe("/");
  });

  it("refuses anything that could leave the site", () => {
    for (const value of [
      "https://evil.example/login",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/\t/evil.example",
      "evil.example",
      "",
      null,
      undefined,
    ]) {
      expect(safeCallbackPath(value)).toBe("/");
    }
  });
});
