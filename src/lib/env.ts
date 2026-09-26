import path from "node:path";

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Validates the server environment once at startup (see
 * src/instrumentation.ts). Pure: takes the env object, returns problems —
 * messages name the variable, never its value.
 */
export function validateServerEnv(
  env: Record<string, string | undefined>,
  cwd: string = process.cwd(),
): {
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

  // The canonical public URL. Auth.js builds its redirects and callback
  // URLs from it instead of the request's Host / X-Forwarded-* headers, and
  // an https URL makes it issue Secure (__Secure-/__Host-) cookies no matter
  // what the reverse proxy forwards. Required in production: without it,
  // cookie security and link origins would depend on proxy headers.
  const canonicalKey = env.AUTH_URL ? "AUTH_URL" : env.NEXTAUTH_URL ? "NEXTAUTH_URL" : null;
  if (production && !canonicalKey) {
    errors.push("AUTH_URL must be set in production to the site's public https URL (e.g. https://edu.example.com)");
  }
  for (const key of ["AUTH_URL", "NEXTAUTH_URL", "APP_BASE_URL"] as const) {
    const value = env[key];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (production && url.protocol !== "https:" && !isLoopback(url.hostname)) {
        errors.push(`${key} must be an https URL in production (plain http is only accepted for localhost)`);
      }
    } catch {
      errors.push(`${key} is not a valid URL`);
    }
  }
  const canonicalOrigin = canonicalKey ? originOf(env[canonicalKey]!) : null;
  const appOrigin = env.APP_BASE_URL ? originOf(env.APP_BASE_URL) : null;
  if (canonicalOrigin && appOrigin && canonicalOrigin !== appOrigin) {
    warnings.push(`APP_BASE_URL and ${canonicalKey} point to different origins — certificate QR codes and sign-in would use different sites`);
  }

  if (env.STORAGE_ROOT && !path.isAbsolute(env.STORAGE_ROOT)) {
    errors.push("STORAGE_ROOT must be an absolute path");
  }
  if (production && !env.STORAGE_ROOT) {
    errors.push("STORAGE_ROOT must be set in production to an absolute path on a persistent volume outside the app directory");
  }
  if (env.STORAGE_ROOT && path.isAbsolute(env.STORAGE_ROOT)) {
    const publicDir = path.join(cwd, "public");
    const resolved = path.resolve(env.STORAGE_ROOT);
    if (resolved === publicDir || resolved.startsWith(`${publicDir}${path.sep}`)) {
      errors.push("STORAGE_ROOT must not be inside public/ — everything there is served to anyone");
    }
  }

  if (production && (env.SEED_TEACHER_PASSWORD || env.SEED_TEACHER_EMAIL)) {
    warnings.push("SEED_TEACHER_EMAIL / SEED_TEACHER_PASSWORD are set in the running server's environment — they are only needed once for `npm run db:seed`; remove them");
  }
  if (production) {
    warnings.push("No email/SMS provider is integrated: self-service password reset links are not delivered. Use teacher-issued links (/teacher/accounts) or `npm run password:reset-link` (see DEPLOYMENT.md)");
  }

  return { errors, warnings };
}
