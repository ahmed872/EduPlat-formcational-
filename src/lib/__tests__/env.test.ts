import { describe, expect, it } from "vitest";
import { validateServerEnv } from "@/lib/env";

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db:5432/eduplat",
  AUTH_SECRET: "x".repeat(48),
  AUTH_TRUST_HOST: "true",
  NEXTAUTH_URL: "https://edu.example.com",
  STORAGE_ROOT: "/var/lib/eduplat",
};

describe("validateServerEnv", () => {
  it("accepts a complete production configuration", () => {
    expect(validateServerEnv(good)).toEqual({ errors: [], warnings: [] });
  });

  it("requires DATABASE_URL and AUTH_SECRET", () => {
    const { errors } = validateServerEnv({ ...good, DATABASE_URL: undefined, AUTH_SECRET: undefined });
    expect(errors.join()).toContain("DATABASE_URL");
    expect(errors.join()).toContain("AUTH_SECRET");
  });

  it("rejects a weak or placeholder secret in production only", () => {
    expect(validateServerEnv({ ...good, AUTH_SECRET: "short" }).errors).toHaveLength(1);
    expect(validateServerEnv({ ...good, AUTH_SECRET: "generate-a-strong-random-secret" }).errors).toHaveLength(1);
    expect(validateServerEnv({ ...good, NODE_ENV: "development", AUTH_SECRET: "short" }).errors).toHaveLength(0);
  });

  it("requires AUTH_TRUST_HOST or AUTH_URL in production", () => {
    const { errors } = validateServerEnv({ ...good, AUTH_TRUST_HOST: undefined });
    expect(errors.join()).toContain("AUTH_TRUST_HOST");
    expect(validateServerEnv({ ...good, AUTH_TRUST_HOST: undefined, AUTH_URL: "https://edu.example.com" }).errors).toEqual([]);
  });

  it("rejects malformed URLs and a relative STORAGE_ROOT; warns on http and missing storage root", () => {
    expect(validateServerEnv({ ...good, DATABASE_URL: "mysql://x" }).errors).toHaveLength(1);
    expect(validateServerEnv({ ...good, NEXTAUTH_URL: "not a url" }).errors).toHaveLength(1);
    expect(validateServerEnv({ ...good, STORAGE_ROOT: "storage" }).errors).toHaveLength(1);
    expect(validateServerEnv({ ...good, NEXTAUTH_URL: "http://edu.example.com" }).warnings).toHaveLength(1);
    expect(validateServerEnv({ ...good, STORAGE_ROOT: undefined }).warnings).toHaveLength(1);
  });

  it("never echoes secret values in its messages", () => {
    const secret = "super-secret-value-that-is-too-short";
    const { errors, warnings } = validateServerEnv({ ...good, AUTH_SECRET: secret.slice(0, 10), DATABASE_URL: "mysql://user:hunter2@x" });
    expect([...errors, ...warnings].join()).not.toMatch(/hunter2|super-secr/);
  });
});
