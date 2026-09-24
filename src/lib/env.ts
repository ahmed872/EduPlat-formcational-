import path from "node:path";

/**
 * Validates the server environment once at startup (see
 * src/instrumentation.ts). Pure: takes the env object, returns problems —
 * messages name the variable, never its value.
 */
export function validateServerEnv(env: Record<string, string | undefined>): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === "production";

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    errors.push("DATABASE_URL is not set");
  } else {
    try {
      const url = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) {
        errors.push("DATABASE_URL must be a postgres:// or postgresql:// URL");
      }
    } catch {
      errors.push("DATABASE_URL is not a valid URL");
    }
  }

  const secret = env.AUTH_SECRET;
  if (!secret) {
    errors.push("AUTH_SECRET is not set (it signs sessions, playback and download tokens)");
  } else if (production && (secret.length < 32 || secret === "generate-a-strong-random-secret")) {
    errors.push("AUTH_SECRET must be a random value of at least 32 characters in production (e.g. `openssl rand -base64 48`)");
  }

  if (production && env.AUTH_TRUST_HOST !== "true" && !env.AUTH_URL) {
    errors.push("Set AUTH_TRUST_HOST=true (behind your own proxy/host) or AUTH_URL — otherwise Auth.js rejects every request with UntrustedHost");
  }

  for (const key of ["AUTH_URL", "NEXTAUTH_URL", "APP_BASE_URL"] as const) {
    const value = env[key];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (production && url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        warnings.push(`${key} is not https — session cookies and certificate QR links should use https in production`);
      }
    } catch {
      errors.push(`${key} is not a valid URL`);
    }
  }
  if (production && !env.APP_BASE_URL && !env.AUTH_URL && !env.NEXTAUTH_URL) {
    warnings.push("None of APP_BASE_URL / AUTH_URL / NEXTAUTH_URL is set — certificate QR codes will fall back to the request host");
  }

  if (env.STORAGE_ROOT && !path.isAbsolute(env.STORAGE_ROOT)) {
    errors.push("STORAGE_ROOT must be an absolute path");
  }
  if (production && !env.STORAGE_ROOT) {
    warnings.push("STORAGE_ROOT is not set — private files are stored under ./storage inside the app directory; mount a persistent volume there or set STORAGE_ROOT");
  }

  return { errors, warnings };
}
