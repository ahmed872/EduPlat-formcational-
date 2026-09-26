/**
 * The post-login destination from `?callbackUrl=`. Only a same-origin path
 * is accepted: an absolute URL, a protocol-relative "//host" or a
 * backslash variant ("/\host", which browsers treat like "//host") would
 * turn the login page into an open redirect to a look-alike site.
 */
export function safeCallbackPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\\]/.test(value)) return "/";
  return value;
}
