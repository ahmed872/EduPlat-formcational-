import { describe, expect, it } from "vitest";
import { signInWithCsrfRetry } from "@/lib/sign-in-with-csrf-retry";

type Result = { error?: string; ok: boolean } | undefined;

function scripted(results: Result[]) {
  let calls = 0;
  const attempt = async () => results[Math.min(calls++, results.length - 1)];
  return { attempt, calls: () => calls };
}

// Final audit gap #13: the first login in a fresh browser could be rejected
// with MissingCSRF (a CSRF cookie race inside Auth.js), showing the user a
// misleading "wrong email or password" error.
describe("signInWithCsrfRetry", () => {
  it("retries exactly once after MissingCSRF and returns the retry's result", async () => {
    const s = scripted([{ error: "MissingCSRF", ok: false }, { ok: true }]);
    await expect(signInWithCsrfRetry(s.attempt)).resolves.toEqual({ ok: true });
    expect(s.calls()).toBe(2);
  });

  it("never retries a wrong password (CredentialsSignin)", async () => {
    const s = scripted([{ error: "CredentialsSignin", ok: false }, { ok: true }]);
    await expect(signInWithCsrfRetry(s.attempt)).resolves.toEqual({
      error: "CredentialsSignin",
      ok: false,
    });
    expect(s.calls()).toBe(1);
  });

  it("never retries any other error", async () => {
    const s = scripted([{ error: "Configuration", ok: false }, { ok: true }]);
    await expect(signInWithCsrfRetry(s.attempt)).resolves.toEqual({
      error: "Configuration",
      ok: false,
    });
    expect(s.calls()).toBe(1);
  });

  it("does not loop: a persistent MissingCSRF is reported after one retry", async () => {
    const s = scripted([{ error: "MissingCSRF", ok: false }]);
    await expect(signInWithCsrfRetry(s.attempt)).resolves.toEqual({
      error: "MissingCSRF",
      ok: false,
    });
    expect(s.calls()).toBe(2);
  });

  it("reports a wrong password surfaced by the retry, rather than masking it", async () => {
    const s = scripted([
      { error: "MissingCSRF", ok: false },
      { error: "CredentialsSignin", ok: false },
    ]);
    await expect(signInWithCsrfRetry(s.attempt)).resolves.toEqual({
      error: "CredentialsSignin",
      ok: false,
    });
    expect(s.calls()).toBe(2);
  });

  it("makes a single call when the first attempt succeeds", async () => {
    const s = scripted([{ ok: true }]);
    await expect(signInWithCsrfRetry(s.attempt)).resolves.toEqual({ ok: true });
    expect(s.calls()).toBe(1);
  });

  it("passes through an undefined result (signIn's early-return paths) without retrying", async () => {
    const s = scripted([undefined]);
    await expect(signInWithCsrfRetry(s.attempt)).resolves.toBeUndefined();
    expect(s.calls()).toBe(1);
  });
});
