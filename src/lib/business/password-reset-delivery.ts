import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ResetDelivery } from "@/lib/business/password-reset";

/**
 * How a self-service reset link reaches the user.
 *
 * No email or SMS provider is integrated. In production the link is
 * therefore NOT sent: the request is accepted (same answer as always, so
 * nothing leaks) and a warning without any identifying data is logged.
 * Accounts that need a reset in production get a teacher-issued link
 * (/teacher/accounts) or, for the teacher account itself, the operator
 * script (scripts/issue-password-reset-link.ts). See DEPLOYMENT.md.
 *
 * Outside production, links are appended to a local outbox file so the
 * flow can be exercised end to end. That path refuses to run when
 * NODE_ENV is "production", even if called directly.
 */
export type DeliveryKind = "dev-outbox" | "not-configured";

export function passwordResetDeliveryKind(env: Record<string, string | undefined> = process.env): DeliveryKind {
  return env.NODE_ENV === "production" ? "not-configured" : "dev-outbox";
}

export function devOutboxFile(env: Record<string, string | undefined> = process.env): string {
  return path.join(env.DEV_OUTBOX_DIR || path.join(process.cwd(), ".dev-outbox"), "password-reset.jsonl");
}

function linkOrigin(env: Record<string, string | undefined>): string {
  return new URL(env.APP_BASE_URL || env.AUTH_URL || "http://localhost:3000").origin;
}

export function getPasswordResetDelivery(env: Record<string, string | undefined> = process.env): ResetDelivery {
  if (passwordResetDeliveryKind(env) === "not-configured") {
    return async () => {
      console.warn("[password-reset] a reset link was requested but no email/SMS provider is configured; nothing was sent");
    };
  }
  return async (message) => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("The development reset outbox is disabled in production");
    }
    const file = devOutboxFile(env);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      to: message.to,
      url: `${linkOrigin(env)}${message.resetPath}`,
      expiresAt: message.expiresAt.toISOString(),
    });
    await appendFile(file, `${line}\n`, { mode: 0o600 });
  };
}
