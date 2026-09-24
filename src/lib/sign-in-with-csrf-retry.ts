/** The error Auth.js reports when the double-submit CSRF check fails. */
export const MISSING_CSRF_ERROR = "MissingCSRF";

/**
 * Runs a credentials sign-in and retries it exactly once if, and only if,
 * it failed with `MissingCSRF`.
 *
 * Auth.js mints a new CSRF cookie on any auth request that arrives without
 * one. In a brand-new browser, concurrent cookie-less requests (e.g. the
 * SessionProvider's /api/auth/session and signIn's /api/auth/csrf) can each
 * set a different token, leaving the cookie jar out of step with the token
 * signIn posted. The server then rejects the POST before `authorize()` ever
 * runs. By the retry, the browser already holds one valid cookie, so
 * signIn's fresh /api/auth/csrf call returns the token that matches it.
 *
 * Any other outcome — including a wrong password (`CredentialsSignin`) — is
 * returned untouched, so credential failures are never retried or masked,
 * and a CSRF failure that persists is reported after one retry, never looped.
 */
export async function signInWithCsrfRetry<T extends { error?: string } | undefined>(
  attempt: () => Promise<T>,
): Promise<T> {
  const first = await attempt();
  if (first?.error !== MISSING_CSRF_ERROR) return first;
  return attempt();
}
