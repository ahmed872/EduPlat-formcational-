/**
 * Runs once when the Next.js server starts (before it serves requests).
 * In production a misconfigured environment or unwritable private storage
 * stops the process with a clear message instead of failing on the first
 * login or upload. Messages never include secret values.
 */
export async function register() {
  // Node-only checks live in their own module so the Edge bundle never
  // sees fs / process.exit.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupChecks } = await import("./lib/startup");
    await runStartupChecks();
  }
}

/**
 * Server-side error log without sensitive data: only the method, the path
 * WITHOUT its query string (signed playback/download tokens live there),
 * the route and the error digest/message — never headers or cookies.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
) {
  const message = error instanceof Error ? error.message : String(error);
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      method: request.method,
      path: request.path.split("?")[0],
      route: context.routePath,
      type: context.routeType,
      digest,
      message: message.slice(0, 500),
    }),
  );
}
