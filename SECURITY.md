# Security

## Authentication & sessions

- Passwords are hashed with bcrypt (cost 12) and never stored or logged
  in plain text.
- One policy applies to registration, reset and change
  (`src/lib/business/password.ts`): at least 8 characters, at most 72
  bytes (bcrypt's input limit, so nothing is silently truncated), not
  only spaces, and not equal to the email.
- **Production requires an https `AUTH_URL`** (the server refuses to
  start otherwise). Auth.js then builds redirects from it, not from
  `Host` / `X-Forwarded-*`, and issues `__Secure-` / `__Host-` cookies
  (`Secure`, `HttpOnly`, `SameSite=Lax`). This was verified behind a
  TLS-terminating nginx, including a spoofed `Host`.
- Sessions are JWTs (NextAuth v5, 30-day maximum). `AUTH_SECRET` must be
  a strong random value in production; `.env.example` ships a
  placeholder only.
- **Every session read re-checks the database**
  (`src/lib/business/session-validity.ts`), including every request to
  `/student`, `/teacher`, `/parent` and `/account` through `proxy.ts`. A
  session is treated as signed out when:
  - the account is blocked or deleted;
  - `User.sessionVersion` has moved past the version in the token (every
    password reset or change bumps it, ending all sessions);
  - the session's own id (`sid`) was revoked by sign-out
    (`RevokedSession`). This makes sign-out hold even when an in-flight
    request re-issues the cookie afterwards.
- Blocked users are also rejected at `authorize()`, before a session is
  ever issued.
- Login follows `?callbackUrl=` only to same-origin paths
  (`src/lib/safe-redirect.ts`).

## Password recovery

- Tokens are 32 random bytes (base64url). Only their SHA-256 hash is
  stored (`PasswordResetToken.tokenHash`).
- They are single-use: the claim is a conditional update, so of several
  simultaneous submissions exactly one wins.
- Lifetime is 30 minutes for self-service and 4 hours for a
  teacher-issued link. Issuing a new token deletes any unused one.
- A token for an account blocked after issue is refused.
- Malformed, unknown, expired, used, superseded and blocked-account
  tokens all get the same answer.
- The token is carried in the URL **fragment** (`#token=`), never sent in
  the page request, and removed from the address bar on load. It can't
  appear in proxy access logs or `Referer` headers.
- `/forgot-password` answers identically for existing and unknown emails.
  Only the rate-limit bookkeeping runs before the response; the account
  lookup, token creation and delivery run after it (`next/server`
  `after`).
- Requests are limited to 3 per email per 15 minutes under an advisory
  lock, counted on a hash of the email for every address.
- A weak password doesn't consume the token.
- A successful reset:
  - bumps `sessionVersion`, ending every session including an attacker's;
  - deletes other unused tokens;
  - writes `PASSWORD_RESET` to the audit log.
- A signed-in password change requires the current password. Wrong
  guesses count toward the login lockout. It ends all sessions, including
  the current one, and is audit-logged (`PASSWORD_CHANGE`).
- **Delivery:** no email/SMS provider is integrated.
  - In production nothing is sent, and the page says so.
  - Outside production, links go to a local `.dev-outbox/` file; that
    code refuses to run when `NODE_ENV=production`.
  - Production recovery uses a teacher-issued link for students and
    parents only. The teacher, not the student, is the actor; the link is
    shown once and audit-logged as `ISSUE_PASSWORD_RESET_LINK`.
  - The teacher account uses the operator script
    `npm run password:reset-link` (shell + DB access required).
- Tokens, passwords and emails are never logged.

## Authorization (defense in depth)

Two independent layers, both fail-closed:

1. `src/proxy.ts` (Next.js 16 proxy on the Node.js runtime) redirects
   unauthenticated, invalidated (see above) or wrong-role requests away
   from `/teacher`, `/student`, `/parent` and `/account` before any page
   code runs.
   - This layer is required. A client-side navigation renders only the
     page segment, not the layout, so a page that relies on its layout
     for the auth check is reachable without it.
   - Before 2026-09-26 the proxy trusted any signed JWT, and a blocked
     student's replayed navigation returned the page.
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
- **Session binding (fixed in the gap-closure round)**: every stream
  request must carry a live session whose `studentProfileId` matches the
  token's `studentId` — unconditionally. Previously this check was
  skipped when no session cookie was present, so a copied playback URL
  worked for any bearer, logged in or not, for the token's full 4-hour
  lifetime. The route is now wrapped with `auth()`'s middleware form, which
  decodes the session straight from the request cookies (this is what
  made the rule unit-testable with a real signed cookie), and it inherits
  the live blocked-account re-check from `auth.ts`. Covered by unit tests
  (no cookie → 403, another student's session → 403, blocked student →
  403) and by a browser E2E step. A logged-in student can still use their
  own URL for its lifetime; a copied link no longer works for anyone else.
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

## Content status (publish / unpublish / archive)

`checkVideoAccess`, `checkLessonAvailability` and `assertStudentCanUseLesson`
(`src/lib/business/content-visibility.ts`) compute one effective state over
video → lesson → course and are called by every student-facing surface:
pages, the stream route, notes/bookmarks APIs, the heartbeat, quiz start,
experiment start/submit/move, and attachment listing and download. `DRAFT`
anywhere is refused to everyone, including existing entitlement holders,
without touching their entitlements, and the page does not reveal the title.
`ARCHIVED` keeps working for existing holders only: it is not listed, not
searchable, not free, and can't be granted again. Subscriptions snapshot
only published lessons, so content published later never reaches an older
subscription.

## Lesson attachments

- Files are stored in private storage (`storage/attachments/`, outside
  `public/`) under a random server-generated key. The uploaded file name is
  display metadata only; its directory parts and control characters are
  stripped, and it never becomes a path. The storage layer also rejects
  any key containing `..`, a slash, a backslash or NUL, or one that
  resolves outside its root.
- The type is detected from magic bytes and must match the extension
  (PDF, PNG, JPG, DOCX, PPTX, up to 25 MB); the browser's MIME type is
  ignored.
- Students download via `/api/attachments/[id]?token=…`. The token is
  HMAC-signed, valid for 10 minutes, domain-separated from video playback
  tokens, and bound to the student and the attachment. On every request
  the route requires a live session matching the token, re-derives the
  lesson from the database, and re-runs the full lesson access check. An
  edited id, a copied link, a revoked entitlement or an unpublished lesson
  is refused.
- Responses are forced downloads (`Content-Disposition: attachment` with
  an RFC 5987 file name) with `nosniff`, `Content-Security-Policy:
  sandbox` and `Cache-Control: private, no-store`, so an uploaded file
  cannot run as a page on this origin. Teachers download with their
  session.

## Interactive experiments

- The stored config, including the answer key, never reaches the browser.
  Pages receive only `toPublicExperiment()`: item lists are shuffled with
  their categories and order removed, and mini-game questions have no
  correct index. A mini-game move answers only "right/wrong", never which
  choice was correct.
- `startAttempt` / `submitAttempt` / `playMove` each re-check the session
  role, lesson availability (entitlement + publication + prerequisite) and
  attempt ownership on the server. "Not found" and "someone else's
  attempt" return the same error. Completion only comes from a passing
  server-side grade. Empty, partial, duplicate, out-of-range and
  off-step submissions are rejected, and closing an attempt is an atomic
  conditional update.
- Simulation formulas use a small parser and evaluator (no
  `eval`/`Function`). Only numbers, the declared variables, arithmetic
  operators and a fixed whitelist of math functions are allowed; lookups
  use own properties only, so names like `constructor(…)` are rejected.
- The mini-game clock is the attempt's server-side `startedAt`. Answers
  after the limit plus a 10-second grace are ignored, and answers must
  arrive in order. Concurrent moves are serialized with an
  optimistic-concurrency guard.
- EXERCISE study time: the client sends a heartbeat only while the tab is
  visible and the student interacted in the last 30 s. The server credits
  it only during a live attempt of an accessible lesson (at most 2 hours,
  or the mini game's round time). A script calling the heartbeat directly
  therefore cannot earn time for an exercise that isn't in progress.

## Certificates

The public verification page (`/certificates/verify/[code]`, no login,
`noindex`) validates the code format before any lookup and matches only
the exact code. Codes have about 50 bits of randomness, so they can't be
enumerated, and nothing else in the URL is trusted. Internal ids are never
accepted and never shown. The page reports valid, revoked or not found;
the teacher's revocation reason stays private. The QR code is generated
locally with the `qrcode` library and encodes only that public URL, built
from the configured origin (`APP_BASE_URL` / `AUTH_URL` / `NEXTAUTH_URL`),
never from the request's `Host` header. Revoke and restore are
teacher-only and audit-logged.

## Reports (preview / PDF)

The report preview is the printable document. The browser's print dialog
("Save as PDF") produces the PDF locally, and no external service
receives report data. `getReportForViewer` is the only gate:
- A teacher may open any report.
- A parent may open only reports of a student with an approved link, and
  only under that student's URL.
- Anyone else is refused.
Refusals return 404.

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
`AuditLog` row (actor, action, entity, metadata). Each transition is an
atomic conditional update (`PENDING → SUCCEEDED | FAILED`,
`SUCCEEDED → REFUNDED`). A reject racing a confirm, or two refunds, can't
both succeed; this was a real race before 2026-09-26. Subscription-backed
access also requires the subscription to be `ACTIVE`, so a refund cancels
access even for a grant that lands late. Wiring a real provider
means implementing `PaymentProvider.createIntent()` against its API (its
webhook handler would call the same `confirmPayment()`/`rejectPayment()`
functions, replacing the human click) — the checkout flow itself does not
change.

## Anti-abuse (current state)

- **View limit, server-authoritative (re-fixed 2026-09-25).** Until then,
  views were consumed only when the player reported progress. A client
  that skipped that call, or reported an inflated duration, could stream
  a paid video without limit: reproduced, 6 full streams with 0 views
  consumed. Now:
  - every playback URL is bound to its own `WatchSession` inside the
    signed token;
  - the stream route records which 1% slices of the file it actually
    delivered, and consumes a view once the configured threshold
    (default 80%) of the bytes has been received;
  - player-reported progress still counts too, using the server's
    duration when one is known;
  - consumption is serialized per student+video with an advisory lock,
    and the session that used the last allowed view may finish it.

  Trade-off: for very small files, browser prefetch can count a view near
  playback start. Opening a page without receiving the video still never
  consumes a view. The paragraph below describes the earlier fix, which
  still applies.
- View-limit consumption requires crossing a configurable completion
  threshold (default 80%) — opening a page alone can never consume a paid
  view. The limit itself is re-checked atomically, inside a transaction,
  at the exact moment a view is consumed (`updateWatchProgress`) — not
  only when a watch session is first created — closing a real bug (fixed
  in the final audit) where opening several sessions up front and only
  then consuming them let every one flip to consumed independently,
  exceeding the paid view limit via ordinary API calls.
- Heartbeat crediting caps elapsed time per tick (30s) so a delayed or
  replayed heartbeat cannot inflate study time; the credit-or-not decision
  itself is now an atomic optimistic-concurrency update (fixed in the
  final audit), so two near-simultaneous heartbeats for the same session
  can no longer both credit the same elapsed gap. The endpoint also now
  validates that the `refId` a heartbeat claims refers to a real video/
  exercise the student is actually entitled to, rather than accepting any
  client-supplied string.
- Promo-code usage-limit and store stock-decrement are both enforced via a
  single atomic conditional `UPDATE` (`WHERE usedCount < limit` / `WHERE
  stock >= quantity`), not a read-then-write — even inside a
  `$transaction`, a plain check-then-act is not safe under Postgres's
  default READ COMMITTED isolation, which was a real, exploitable race
  fixed in the final audit (proven closed with genuine concurrent-load
  tests against the real Postgres test database).
- Certificate double-issuance and "one daily-game play per day" are both
  backed by real `@@unique` database constraints (not just an
  application-level check), for the same reason.
- Login rate limiting is real and server-side (`src/lib/business/security.ts`):
  a configurable rolling window of failed attempts per (case-insensitive)
  email blocks further attempts regardless of whether a later password
  would have been correct. Blocking an account now also invalidates an
  already-issued session on its very next request, not just future logins.
- Game timing is server-authoritative: each session's `durationMinutes`
  (~5 for MINI, ~10 for DAILY_MAIN) is enforced against `startedAt` when
  the score is submitted, using server time only, and a late submission
  earns zero points. MINI's once-per-hour window and DAILY_MAIN's
  once-per-day rule are both real DB unique constraints. The countdown in
  the player is display-only.
- User-supplied links that are rendered as `href`s (career-field
  resources, teacher social links) accept only `http(s)` URLs, validated
  in the business layer and filtered again on read, so a `javascript:` URL
  can never reach the page. Teacher phone/email are pattern-validated
  before being rendered into `tel:`/`mailto:` links.
- **Not yet implemented**: concurrent-session/device-change detection (see
  the "Not yet implemented" note above — would require moving off
  stateless JWT sessions). No automatic banning exists anywhere in the
  codebase — the spec explicitly requires human review for weak signals,
  and no such automation has been built to bypass that.
- **First-login CSRF race (fixed)**: Auth.js v5 issues a fresh CSRF cookie
  on *any* auth request that lacks one, so on the very first login in a
  brand-new browser, concurrent cookie-less auth requests could set two
  different tokens and the login POST was rejected with `MissingCSRF`,
  shown to the user as "wrong email or password". `login-form.tsx` now
  retries `signIn` exactly once, and only for `MissingCSRF`
  (`src/lib/sign-in-with-csrf-retry.ts`). The retry is a second, complete
  sign-in: it re-fetches the CSRF token, and CSRF validation, the
  credential check and the login rate limit all run again. Auth.js's CSRF
  protection is unchanged and still rejects any mismatched token.
  `CredentialsSignin` (wrong password) and every other error are never
  retried, so rate limiting still sees exactly one attempt per submit. A
  CSRF failure that persists is reported after one retry, never looped.
- **External security enhancement (not in the original requirements)**: no
  CAPTCHA on registration. Adding one needs an external provider
  (reCAPTCHA/hCaptcha/Turnstile).

## Deployment hardening (2026-09-25)

- **Startup validation** (`src/instrumentation.ts` → `src/lib/startup.ts`
  and `src/lib/env.ts`):
  - checks `DATABASE_URL`, `AUTH_SECRET` (at least 32 characters, not the
    placeholder), `AUTH_TRUST_HOST` / `AUTH_URL`, URL formats and an
    absolute `STORAGE_ROOT` (tightened 2026-09-26: an https `AUTH_URL`
    and `STORAGE_ROOT` are now required, see below);
  - probes that private storage is writable (bounded to 5 seconds);
  - in production any failure exits the process;
  - messages name variables, never values. Verified with the secret
    grepped from the logs: 0 occurrences.
- **No default admin in production:** the seed requires
  `SEED_TEACHER_EMAIL` / `SEED_TEACHER_PASSWORD` (at least 12 characters)
  when `NODE_ENV=production` and never prints the password. The
  development default `ChangeMe123!` is for local use only.
- **Private files** are created owner-only (directories 700, files 600)
  under `STORAGE_ROOT`. Raw storage paths are never served; verified over
  HTTP for videos and attachments.
- **Security headers** on every response:
  - `X-Frame-Options: DENY`;
  - CSP `frame-ancestors 'none'; base-uri 'self'; form-action 'self';
    object-src 'none'`;
  - `X-Content-Type-Options: nosniff` and
    `Referrer-Policy: strict-origin-when-cross-origin`;
  - a restrictive `Permissions-Policy`, and HSTS in production;
  - `X-Powered-By` removed.

  **Follow-up:** a `script-src` CSP needs per-request nonces through
  every page and is not in place.
- **Logging:** server errors are logged as one JSON line each (method,
  path **without query string**, route, digest, message), because signed
  playback and download tokens live in query strings. Headers and
  cookies are never logged. `/api/health` reports only ok/unavailable.
- **Error pages:** Arabic `error.tsx` / `global-error.tsx` /
  `not-found.tsx`. In production only a reference digest is shown, never
  the internal message.
- **Checkout integrity:**
  - a subscription is never sold once the academic-year end has passed;
  - at most one open (pending or unexpired active) subscription per
    student and plan, enforced server-side under an advisory lock;
  - verified by replaying the real Server Action in parallel.
- **Upload limits:** the Server Action body limit is 500 MB globally
  (needed for video upload). The reverse proxy must enforce per-path
  limits (DEPLOYMENT.md §5). Attachments are also capped at 25 MB in code.
- **Rate limits:** in-app login throttling only. Registration,
  heartbeats and playback-URL issuance rely on proxy rate limits
  (DEPLOYMENT.md §5).
- **Not implemented:** password reset / change for any role (needs an
  email/SMS provider or an owner decision; see the go-live checklist) and
  CAPTCHA.

## Go-live hardening (2026-09-26)

- **Configuration fails closed.** In production the server exits when:
  - `AUTH_URL` is missing or not https (except localhost);
  - `STORAGE_ROOT` is missing, relative or under `public/`;
  - the secret is weak;
  - storage is unwritable.

  The storage probe never runs under a rejected root. Seed credentials
  left in the runtime environment produce a warning.
- **Uploads.**
  - Videos and shorts must start with a real MP4/MOV `ftyp` box or a WebM
    EBML header that matches the declared type.
  - The stored extension comes from the detected container, never the
    client filename.
  - Replacing a video updates the row before deleting the old file, and
    keeps the video's publication status.
- **Streaming.** Byte ranges follow RFC 9110 (end clamped, suffix
  ranges). Every range request re-checks the signed token (bound to
  student + video + watch session), the entitlement and the publication
  state.
- **Verified end to end on the final build:**
  - A copied signed URL gives 403 to another account; expired and
    tampered URLs give 401.
  - Direct storage paths return 404, and IDOR attempts are refused.
  - A blocked user's live session ends.
  - Pre-logout cookies are refused after sign-out.
  - 5 parallel checkouts produce 1 subscription.
- **Accepted residual risks:**
  - Registration answers 409 for an existing email, which is inherent to
    self-registration; mitigate with the proxy rate limit on
    `/api/auth/register`.
  - `script-src` is not restricted by CSP (it would need nonces).
  - No CAPTCHA (optional external provider).

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
