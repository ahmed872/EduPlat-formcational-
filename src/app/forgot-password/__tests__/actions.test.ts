import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import { RESET_REQUEST_LIMIT } from "@/lib/business/password-reset";

// `after()` needs a live request; run its callback inline instead.
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  after: (fn: () => Promise<unknown>) => {
    pending.push(fn());
  },
}));

const outboxDir = path.join(os.tmpdir(), `reset-outbox-${process.pid}`);

beforeEach(async () => {
  await resetDatabase();
  pending.length = 0;
  vi.stubEnv("DEV_OUTBOX_DIR", outboxDir);
  await rm(outboxDir, { recursive: true, force: true });
});

async function submit(email: string) {
  const { requestReset } = await import("@/app/forgot-password/actions");
  const form = new FormData();
  form.set("email", email);
  const state = await requestReset(null, form);
  await Promise.all(pending);
  return state;
}

async function studentEmail() {
  const student = await createStudent();
  return (await prisma.studentProfile.findUniqueOrThrow({ where: { id: student.id }, include: { user: true } })).user.email;
}

describe("forgot-password server action", () => {
  it("answers identically for an existing and a non-existent account", async () => {
    const existing = await submit(await studentEmail());
    const missing = await submit("nobody-here@test.local");
    expect(existing).toEqual(missing);
    expect(existing?.status).toBe("sent");
    expect(await prisma.passwordResetToken.count()).toBe(1);
  });

  it("writes the link only to the development outbox, with the token in the URL fragment", async () => {
    const email = await studentEmail();
    await submit(email);
    const lines = (await readFile(path.join(outboxDir, "password-reset.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.to).toBe(email);
    expect(entry.url).toMatch(/\/reset-password#token=[A-Za-z0-9_-]{43}$/);
  });

  it("rate-limits with a message that doesn't depend on the account", async () => {
    const email = await studentEmail();
    for (let i = 0; i < RESET_REQUEST_LIMIT; i++) await submit(email);
    const limitedExisting = await submit(email);
    for (let i = 0; i < RESET_REQUEST_LIMIT; i++) await submit("ghost@test.local");
    const limitedMissing = await submit("ghost@test.local");
    expect(limitedExisting).toEqual(limitedMissing);
    expect(limitedExisting?.status).toBe("rate_limited");
    expect(await prisma.passwordResetToken.count()).toBe(1); // newer requests replaced, never piled up
  });

  it("rejects a malformed email without touching the database", async () => {
    expect((await submit("not-an-email"))?.status).toBe("invalid");
    expect(await prisma.passwordResetRequest.count()).toBe(0);
  });

  it("in production sends nothing, says so honestly, and logs no email or token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const email = await studentEmail();
      const state = await submit(email);
      expect(state?.status).toBe("sent");
      expect(state?.message).toMatch(/غير مفعّل/);
      await expect(readFile(path.join(outboxDir, "password-reset.jsonl"), "utf8")).rejects.toThrow();
      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toMatch(/no email\/SMS provider/);
      expect(logged).not.toContain(email);
      expect(logged).not.toMatch(/token=|[A-Za-z0-9_-]{43}/);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
