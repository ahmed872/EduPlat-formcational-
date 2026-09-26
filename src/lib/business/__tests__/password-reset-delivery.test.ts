import { afterEach, describe, expect, it, vi } from "vitest";
import { getPasswordResetDelivery, passwordResetDeliveryKind } from "@/lib/business/password-reset-delivery";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("password reset delivery", () => {
  it("has no delivery channel in production (no provider is integrated)", () => {
    expect(passwordResetDeliveryKind({ NODE_ENV: "production" })).toBe("not-configured");
    expect(passwordResetDeliveryKind({ NODE_ENV: "development" })).toBe("dev-outbox");
    expect(passwordResetDeliveryKind({ NODE_ENV: "test" })).toBe("dev-outbox");
  });

  it("refuses to write the development outbox when the process runs in production", async () => {
    const devDelivery = getPasswordResetDelivery({ NODE_ENV: "development", DEV_OUTBOX_DIR: "/tmp/should-not-be-written" });
    vi.stubEnv("NODE_ENV", "production");
    await expect(
      devDelivery({ to: "a@test.local", name: "A", resetPath: "/reset-password#token=x", expiresAt: new Date() }),
    ).rejects.toThrow(/disabled in production/);
  });
});
