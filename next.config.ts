import type { NextConfig } from "next";

/**
 * Baseline security headers for every response. The CSP here only restricts
 * what is safe without per-request nonces (framing, base URI, form targets,
 * plugins); a script-src policy would need nonce plumbing through every
 * page and is listed as a follow-up in SECURITY.md.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Browsers only honor HSTS over HTTPS, so this is inert on plain-HTTP dev.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    serverActions: {
      // Lesson videos are uploaded via a Server Action; raise the default
      // body limit so a real (if modest) video file doesn't get rejected.
      // This limit applies to every Server Action, so production must also
      // cap request bodies per path at the reverse proxy (see DEPLOYMENT.md).
      // A deployment behind a real object-storage provider would instead
      // upload directly to that provider and skip the app server.
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
