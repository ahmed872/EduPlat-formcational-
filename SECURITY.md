# Security

## Authentication & sessions

- Passwords hashed with bcrypt (cost 12), never stored or logged in plain
  text.
- Sessions are JWT-based (NextAuth v5). `AUTH_SECRET` must be a strong random
  value in production — `.env.example` ships a placeholder only.
- Blocked users (`User.status = BLOCKED`) are rejected at the `authorize()`
  step, before a session can ever be issued.

## Authorization (defense in depth)

Two independent layers, both fail-closed:

1. `src/proxy.ts` (Next.js's edge middleware) redirects unauthenticated or
   wrong-role requests away from `/teacher`, `/student`, `/parent` before
   any page code runs.
2. Every server component, Server Action, and Route Handler under those
   trees re-checks the role itself via `requireRole()`/manual session checks
   (`src/lib/rbac.ts`) — proxy/middleware is treated as a UX convenience,
   never as the security boundary, per the "server-side authorization for
   protected content" requirement.

Parent access is additionally scoped per-student: `assertParentCanAccessStudent()`
requires an explicit `ParentStudent` row; a parent can never read a student
they aren't linked to, and linking never grants access to paid course
content (parents see progress/reports only).

## Input validation

All Route Handlers and Server Actions that accept user input validate it
with `zod` schemas (or explicit checks for simple string fields in Server
Actions) before touching the database. Prisma's parameterized queries
prevent SQL injection; the one raw-SQL usage (`resetDatabase()` in test
utilities) only runs against the disposable test database and only
interpolates table names read back from `pg_tables`, never user input.

## Video protection

- **Private storage**: uploaded videos live under `storage/videos/` on disk
  (`src/lib/storage/provider.ts`), never inside `public/`. Next.js's static
  file server cannot reach them; the only code path that ever reads one is
  `src/app/api/stream/[videoId]/route.ts`.
- **No raw file path or public URL is ever sent to the client.** The
  student's browser only ever sees a short-lived signed URL
  (`/api/stream/<videoId>?token=...`).
- **Signed, expiring playback tokens** (`src/lib/business/playback.ts`):
  HMAC-SHA256 (keyed by `AUTH_SECRET`) over `{studentId, videoId, exp}`,
  verified with a constant-time comparison (`timingSafeEqual`) to avoid
  timing side-channels. `issueSignedPlaybackUrl()` re-runs the full
  `checkVideoAccess()` gate before minting a token — a token is never
  issued to a non-entitled student in the first place.
- **Server-side re-verification on every stream request**: the streaming
  route does not trust a valid-looking token as proof of *current* access —
  it decodes the token, then calls `checkVideoAccess()` again before
  streaming a single byte. A subscription refunded/cancelled mid-window (or
  a view-limit newly reached by a concurrent session) is caught here even
  if the token itself hasn't expired yet.
- **HTTP Range support** (206 Partial Content) is implemented against the
  private file directly, enabling real seeking/scrubbing/resume in
  standard `<video>` elements without needing a separate segmenting step.
- **Identity watermark**: while a video plays, the student's name is
  overlaid on the player and its position jitters every 20s
  (`src/app/student/videos/[videoId]/video-player.tsx`). This is a
  deterrent against casual screen-recording redistribution, not a
  cryptographic protection, and is described as such here rather than
  oversold.
- **Not yet implemented**: HLS/DASH segmenting (needs a real media
  pipeline — no `ffmpeg` or transcoding service is available in this
  environment), concurrent-session/device-limit detection, and real DRM
  (Widevine/FairPlay via a licensed streaming provider). The storage
  abstraction is deliberately provider-swappable (`StorageProvider`
  interface) so a DRM-capable provider (Cloudflare Stream, Mux) can replace
  the local-disk implementation later without touching
  `checkVideoAccess()`/`issueSignedPlaybackUrl()`. **No video piracy
  protection is or will be claimed as 100% effective** — the goal here is
  strong, auditable, server-verified authorization on every request, not
  an unbreakable guarantee; a sufficiently motivated viewer can always
  screen-record what their own device is legitimately allowed to display,
  and no software-only scheme changes that.

## Payments

`Payment` is provider-agnostic (`src/lib/payments/provider.ts`) and no real
gateway (Stripe/PayMob/Fawry/...) is wired up. **No payment success is ever
faked**: for a non-zero amount, `Payment.status` starts at `PENDING` and
the *only* code path that can move it to `SUCCEEDED` is `confirmPayment()`
(`src/lib/business/subscription.ts`), which requires an authenticated
`TEACHER_ADMIN` session and is meant to be called only after that person
has verified real money actually arrived (bank transfer, cash, mobile
wallet, ...) outside the app. There is no client-callable endpoint that can
set a payment to `SUCCEEDED` for a non-zero amount. The only synchronous
"success" is a genuinely zero-amount checkout (free plan, or a `FREE_100`
promo) — there being nothing to collect is not the same as faking that
something was collected. Every confirm/reject/refund transition writes an
`AuditLog` row (actor, action, entity, metadata). Wiring a real provider
means implementing `PaymentProvider.createIntent()` against its API (its
webhook handler would call the same `confirmPayment()`/`rejectPayment()`
functions, replacing the human click) — the checkout flow itself does not
change.

## Anti-abuse (current state)

- View-limit consumption requires crossing a configurable completion
  threshold (default 80%) — opening a page alone can never consume a paid
  view.
- Heartbeat crediting caps elapsed time per tick (30s) so a delayed or
  replayed heartbeat cannot inflate study time.
- Promo redemption is transactional (`$transaction`) so concurrent
  redemptions cannot both slip through a usage-limit-reached code.
- **Not yet implemented**: concurrent-session/device-change detection and
  rate limiting at the HTTP layer. No automatic banning exists anywhere in
  the codebase — the spec explicitly requires human review for weak
  signals, and no such automation has been built to bypass that.

## Known dependency advisories

`npm audit` currently reports a high-severity advisory in `deepmerge-ts`, a
transitive dependency of `@prisma/config` (the Prisma CLI's config loader,
used only for local `prisma migrate`/`generate`, never bundled into the
deployed app, and never fed untrusted input beyond the project's own
`schema.prisma`/`prisma.config.ts`). `npm audit fix --force` would downgrade
`prisma`/`@prisma/client` to 6.12.0 — an actual regression, not a real fix —
so it was left alone and is tracked as a follow-up: revisit once Prisma
ships a patched `@prisma/config` on the 6.19.x/6.20.x line.

## Secrets

No secret is hardcoded. `.env` (git-ignored) holds `DATABASE_URL` and
`AUTH_SECRET` for local development; `.env.example` documents the required
shape without real values.
