import { describe, expect, it } from "vitest";
import { validateServerEnv } from "@/lib/env";

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db:5432/eduplat",
  AUTH_SECRET: "x".repeat(48),
  AUTH_URL: "https://edu.example.com",
  STORAGE_ROOT: "/var/lib/eduplat",
};
const cwd = "/srv/eduplat/app";
const check = (env: Record<string, string | undefined>) => validateServerEnv(env, cwd);
// The one production warning that is always present (no email/SMS provider is integrated).
const DELIVERY_WARNING = /No email\/SMS provider/;

describe("validateServerEnv", () => {
  it("accepts a complete production configuration", () => {
    const { errors, warnings } = check(good);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(DELIVERY_WARNING);
  });

  it("requires DATABASE_URL and AUTH_SECRET", () => {
    const { errors } = check({ ...good, DATABASE_URL: undefined, AUTH_SECRET: undefined });
    expect(errors.join()).toContain("DATABASE_URL");
    expect(errors.join()).toContain("AUTH_SECRET");
  });

  it("rejects a weak or placeholder secret in production only", () => {
    expect(check({ ...good, AUTH_SECRET: "short" }).errors).toHaveLength(1);
    expect(check({ ...good, AUTH_SECRET: "generate-a-strong-random-secret" }).errors).toHaveLength(1);
    expect(check({ ...good, NODE_ENV: "development", AUTH_SECRET: "short" }).errors).toHaveLength(0);
  });

  it("requires the canonical AUTH_URL in production; AUTH_TRUST_HOST alone is not enough", () => {
    expect(check({ ...good, AUTH_URL: undefined, AUTH_TRUST_HOST: "true" }).errors.join()).toContain("AUTH_URL must be set");
    expect(check({ ...good, AUTH_URL: undefined, NEXTAUTH_URL: "https://edu.example.com" }).errors).toEqual([]);
    expect(check({ ...good, NODE_ENV: "development", AUTH_URL: undefined, STORAGE_ROOT: undefined }).errors).toEqual([]);
  });

  it("requires https in production except on localhost", () => {
    expect(check({ ...good, AUTH_URL: "http://edu.example.com" }).errors.join()).toContain("https");
    expect(check({ ...good, APP_BASE_URL: "http://edu.example.com" }).errors.join()).toContain("APP_BASE_URL");
    expect(check({ ...good, AUTH_URL: "http://localhost:3000" }).errors).toEqual([]);
    expect(check({ ...good, NODE_ENV: "development", AUTH_URL: "http://edu.example.com" }).errors).toEqual([]);
  });

  it("warns when APP_BASE_URL and AUTH_URL disagree", () => {
    expect(check({ ...good, APP_BASE_URL: "https://other.example.com" }).warnings.join()).toContain("different origins");
    expect(check({ ...good, APP_BASE_URL: "https://edu.example.com/" }).warnings.join()).not.toContain("different origins");
  });

  it("requires an absolute STORAGE_ROOT in production, never inside public/", () => {
    expect(check({ ...good, STORAGE_ROOT: undefined }).errors.join()).toContain("STORAGE_ROOT must be set");
    expect(check({ ...good, STORAGE_ROOT: "storage" }).errors.join()).toContain("absolute");
    expect(check({ ...good, STORAGE_ROOT: `${cwd}/public/files` }).errors.join()).toContain("public/");
    expect(check({ ...good, STORAGE_ROOT: `${cwd}/public` }).errors.join()).toContain("public/");
    expect(check({ ...good, STORAGE_ROOT: `${cwd}/publicity` }).errors).toEqual([]);
  });

  it("rejects malformed URLs", () => {
    expect(check({ ...good, DATABASE_URL: "mysql://x" }).errors).toHaveLength(1);
    expect(check({ ...good, AUTH_URL: "not a url" }).errors.join()).toContain("not a valid URL");
  });

  it("warns when seed credentials are left in the runtime environment", () => {
    expect(check({ ...good, SEED_TEACHER_PASSWORD: "whatever-123456" }).warnings.join()).toContain("SEED_TEACHER");
  });

  it("never echoes secret values in its messages", () => {
    const secret = "super-secret-value-that-is-too-short";
    const { errors, warnings } = check({
      ...good,
      AUTH_SECRET: secret.slice(0, 10),
      DATABASE_URL: "mysql://user:hunter2@x",
      SEED_TEACHER_PASSWORD: "seed-pass-hunter3",
    });
    expect([...errors, ...warnings].join()).not.toMatch(/hunter2|hunter3|super-secr/);
  });
});
