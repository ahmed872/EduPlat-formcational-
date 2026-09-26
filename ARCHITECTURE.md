# Architecture

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript, React 19) — a single
  modular monolith, not microservices. Server Components render dashboards
  directly from the database; Server Actions and Route Handlers implement
  mutations and JSON APIs.
- **Database**: PostgreSQL, accessed through Prisma ORM (`prisma/schema.prisma`).
- **Auth**: NextAuth v5 (Credentials provider), JWT sessions. Role-based
  access control (`STUDENT`, `PARENT`, `TEACHER_ADMIN`) enforced both in
  `src/proxy.ts` (Next 16 "Proxy", formerly middleware; it runs on the
  Node.js runtime and re-checks the account in the database on every
  protected request — blocked, password reset/changed, signed out) and
  again inside every server component/route/action via `src/lib/rbac.ts`.
  `TEACHER_ADMIN` is one combined teacher/back-office role for the
  platform owner; such accounts are only created by the seed or an
  operator, never by self-registration.
- **Testing**: Vitest, running business-logic tests against a real,
  disposable PostgreSQL database (`eduplat_test`), not mocks — the tests
  exercise actual Prisma queries and transactions.
- **Styling**: Tailwind CSS v4, RTL-first (`dir="rtl"`, `lang="ar"` on
  `<html>`), Arabic UI copy throughout. English can be added later via a
  standard i18n layer without restructuring.

## Module layout

```
src/
  auth.ts / auth.config.ts   NextAuth setup (auth.ts adds the live DB session check)
  proxy.ts                   Route-level gate for /teacher, /parent, /student, /account
  lib/
    prisma.ts                Prisma client singleton
    rbac.ts                  requireRole/requireSession + error → HTTP mapping
    platform-settings.ts     Configurable business-rule registry (see below)
    business/                Pure business-rule modules, framework-agnostic,
                              each with a __tests__ sibling:
      video-access.ts        Entitlement checks, view-limit consumption
      quiz.ts                Grading, attempt limits, lesson unlocking
      study-time.ts          Heartbeat-based active-time tracking, streaks
      promo-code.ts          Promo validation/redemption/discount math
      parent-access.ts       Parent → student access guard
  app/
    teacher/...               Teacher/admin CMS (categories, courses, lessons)
    student/...                Student dashboard, video watch page
    parent/...                 Parent dashboard
    api/...                    Route handlers (auth, watch-sessions, heartbeat)
```

## Why an explicit Entitlement table (not "has active subscription ⇒ sees everything")

Section 8 of the spec requires that new content published after a purchase
must NOT automatically become visible to a student who already subscribed to
that course. `grantEntitlementsForSubscription()` (`src/lib/business/video-access.ts`)
snapshots the plan's content into individual `Entitlement` rows *at purchase
time*. `checkVideoAccess()` never asks "is there an active subscription for
this course?" — it asks "is there a non-revoked Entitlement row for this
exact video/lesson?". This makes every grant auditable (who/when/why —
`reason: SUBSCRIPTION | PROMO | FREE | ADMIN_GRANT`) and immune to content
leaking backwards or forwards in time. Covered by
`src/lib/business/__tests__/video-access.test.ts`.

## Why heartbeats, not a wall-clock timer, for study time

`recordHeartbeat()` only credits time when the client sends a heartbeat
*and* the gap since the last one is small (≤ 30s). The client is expected to
call it only while a video is actually playing and the tab is visible
(Page Visibility API) or an exercise is being actively used. A paused video,
a backgrounded tab, or an idle student simply stops the heartbeat calls —
the server never "fills in" that gap. This is a trust-the-cadence design,
not a trust-the-client-flag design: a single stale/replayed heartbeat cannot
inflate time because credited seconds are always `now - lastHeartbeatAt`,
capped at the max gap.

## Configurable business rules

Nothing described as a "default" in the spec is hardcoded. `src/lib/platform-settings.ts`
defines every tunable (default video view limit, view-consumption threshold
%, default passing score, default quiz attempts, academic-year end date,
minimum daily minutes for a streak, max Short duration) with a sane default
that the teacher/admin can override at runtime via the `PlatformSetting`
table, without a code change or redeploy.

## Video storage & secure playback (Phase 3)

`src/lib/storage/provider.ts` defines `StorageProvider` (`save`, `readStream`
with HTTP-Range support, `getSize`, `delete`, `generateKey`) and one
implementation, `LocalPrivateStorageProvider`, backed by `storage/videos/`
on disk — a directory that is never inside `public/` and is only ever read
by the streaming route below. `Video.storageProvider`/`storageKey` record
which provider/key a video lives at, so a real cloud provider (S3, R2,
Cloudflare Stream, Mux) can implement the same interface and replace it via
`getVideoStorageProvider()` without touching upload actions, playback
issuance, or the streaming route.

**Upload**: `uploadLessonVideo()` (a Server Action in
`src/app/teacher/courses/actions.ts`) validates the file type/size, saves it
through the storage provider, and creates/replaces the lesson's `Video`
row. Duration is teacher-entered (no `ffprobe`/media-probing tool is
available in this environment to detect it automatically).

**Playback authorization**: `src/lib/business/playback.ts` issues an
HMAC-signed, time-limited token (`issuePlaybackToken`/`verifyPlaybackToken`)
after `issueSignedPlaybackUrl()` re-runs `checkVideoAccess()` — a token is
never handed out to a non-entitled student. The resulting URL
(`/api/playback-url` is the Route Handler a student calls to get one) looks
like `/api/stream/<videoId>?token=...`.

**Streaming**: `src/app/api/stream/[videoId]/route.ts` is the only code
path that ever reads a video file. It verifies the token, cross-checks any
active session against the token's student, and — critically — re-runs
`checkVideoAccess()` again before streaming a byte, so access revoked after
a token was issued (refund, a concurrent session reaching the view limit)
is still caught. It implements HTTP Range/206 responses against the private
file directly, giving real seek/scrub/resume support in a plain `<video>`
element without a separate segmenting step.

**Player**: `src/app/student/videos/[videoId]/video-player.tsx` is a real
`<video>` element wired to the same watch-session/heartbeat APIs Phase 1
built — `onPlay` starts heartbeat + progress-save intervals (paused only
while the tab is visible, per the study-time rules), resuming from the
student's last recorded position via `resumeFromSeconds`. It also overlays
a jittering student-identity watermark as a deterrent (not a cryptographic
guarantee — see SECURITY.md).

**What's not implemented**: HLS/DASH segmenting (needs `ffmpeg` or a media
pipeline unavailable here) and real DRM. The interfaces above are the seam
where both would plug in later.

## Shorts & timestamp system (Phase 4)

Shorts are free/public by design (spec section 12), so they deliberately
skip the entitlement machinery paid videos go through — but still stream
through a controlled route rather than a public static path, so the
storage layer stays uniformly private. `src/lib/http/range-stream.ts`
factors out the HTTP Range/206 response logic shared by both
`/api/stream/[videoId]` (paid, token + entitlement gated) and
`/api/stream-short/[shortId]` (public, only checks `status = PUBLISHED`).

**Short → original video linking**: `Short.sourceVideoId` +
`sourceTimestampSeconds` (already in the Phase-1 schema) are set at upload
time by the teacher. `src/lib/business/shorts.ts`'s
`resolveShortCallToAction()` is the single decision point for "what happens
when this Short ends":
- no source video linked → `NO_SOURCE`
- a guest (no `studentId`) → `SUBSCRIBE_CTA` (never even attempts an
  entitlement check — a guest can never be entitled to anything)
- a logged-in student → runs the exact same `checkVideoAccess()` gate a
  full video page would, returning `OPEN_ORIGINAL` (with the video id and
  timestamp to seek to) or `SUBSCRIBE_CTA`

The student-facing player (`src/app/shorts/[shortId]/short-player.tsx`)
reveals this CTA on the video's `ended` event, and `OPEN_ORIGINAL` links to
`/student/videos/[videoId]?t=<timestampSeconds>`, which the watch page
reads to seek the real player to that exact moment (taking priority over
resuming from a previous watch session).

**Chapters**: `VideoChapter` (Phase-1 schema, already rendered on the
student watch page) now has a teacher-facing CRUD editor in the lesson's
video-upload block (`addVideoChapter`/`deleteVideoChapter` in
`src/app/teacher/courses/actions.ts`).

## Student learning features (Phase 5)

**Notes & bookmarks**: thin CRUD routes (`/api/notes`, `/api/bookmarks`)
with inline ownership checks (a student can only delete their own row —
checked by comparing `studentId` before the delete, same pattern as the
existing watch-session routes) rather than a dedicated business module,
since there's no rule here beyond ownership. The video player
(`video-player.tsx`) owns the `<video>` ref, so it also owns the
add/list/seek/delete UI for both, passed initial data as props from the
server-rendered watch page.

**Notifications**: `src/lib/business/notifications.ts` is deliberately the
*only* place a `Notification` row gets created, so every trigger point
(quiz-unlock in `quiz.ts`, subscription activation in `subscription.ts`,
the daily-target check in the heartbeat route) calls the same `notify()`
function. `notifyIfTargetReached()` de-duplicates per calendar day by
querying existing notifications with a Postgres JSON-path filter on
`metadata.periodKey` rather than adding a new column — the achieved-vs-
target comparison itself is computed by the caller (the heartbeat route),
keeping the notification module free of study-time logic. Delivery today
is in-app only (a polling bell component); the same `notify()` call site
is where an email/push side-effect would be added later without touching
any of the business logic that triggers it.

**Targets fallback**: `Target.studentId` is nullable — a null row is a
platform-wide default (`/teacher/targets` manages exactly these), and a
non-null row overrides it for that one student. The student dashboard
and the heartbeat route's target-reached check both resolve "the
effective target for period X" the same way: prefer the student-specific
row, fall back to the global default.

**Free-content discoverability fix**: this phase's own manual testing
surfaced a real bug — a student with zero subscriptions had no way to see
free lessons, because the dashboard only ever rendered courses reachable
through the `Entitlement` table, and a free video/lesson deliberately
never gets an `Entitlement` row (`checkVideoAccess` allows it directly,
by design — see Phase 1). Fixed by querying published free lessons
independently and rendering them in their own dashboard section.

## Subscriptions & payments (Phase 2)

`src/lib/business/subscription.ts` is the checkout/payment state machine;
`src/lib/payments/provider.ts` is the payment-gateway abstraction.

**Checkout** (`startSubscriptionCheckout`): validates the plan, validates
and redeems an optional promo code (`promo-code.ts`), computes the final
price (`applyDiscount`), asks `getActivePaymentProvider(amountCents)` for an
intent, then creates the `Subscription` + `Payment` rows. A zero-amount
intent (either a free plan or a `FREE_100` promo) resolves synchronously to
`SUCCEEDED`/`ACTIVE` and grants entitlements immediately — there is
genuinely nothing to collect, so this is not "faking" a payment. Any
non-zero amount always starts `PENDING_PAYMENT`/`PENDING` and grants
**nothing** until a human confirms it.

**Payment provider abstraction**: `PaymentProvider` has one method,
`createIntent()`. `FreePaymentProvider` handles amount = 0.
`ManualOfflinePaymentProvider` — the only paid-amount implementation today
— always returns `PENDING` with human-readable transfer instructions; it
is explicitly not a real gateway. Wiring one in (Stripe, PayMob, Fawry, ...)
means writing a class that implements `createIntent()` against that
provider's API and changing `getActivePaymentProvider()` to return it for
non-zero amounts — no other code in the checkout flow needs to change.

**Payment states**: `PENDING → SUCCEEDED | FAILED`, and `SUCCEEDED →
REFUNDED`. Every transition away from `PENDING`/`SUCCEEDED` is a named
function (`confirmPayment`, `rejectPayment`, `refundPayment`) that a
teacher/admin calls explicitly; each writes an `AuditLog` row. `confirmPayment`
is the *only* code path in the entire codebase that can mark a non-zero
payment `SUCCEEDED`, and it does so by calling `grantEntitlementsForSubscription`
— the same entitlement-snapshotting function Phase 1 already tested, so a
confirmed paid subscription behaves identically to the free-checkout case
regarding "no future content leaks in".

**Free content outside any subscription**: `FREE_LESSON`/`FREE_PACKAGE`/
`FREE_PERIOD` promo codes are redeemed via `redeemFreeContentPromo()`,
which grants `Entitlement` rows sourced from `PromoApplicableContent`
(`grantEntitlementsForPromoRedemption`) with `reason: PROMO` and no
`subscriptionId` at all — these are genuinely independent of the
subscription system. `FREE_PERIOD` is the one type that sets
`Entitlement.expiresAt` (bounded to the academic-year end); the others are
permanent grants.

**The admin escape hatch**: `grantAdminEntitlement()` creates a single,
audited (`grantedById`) `Entitlement` for one lesson/student pair, for the
case in spec section 8 where a teacher wants to manually unlock one
specific piece of content published after a student's purchase window,
without issuing a whole new subscription.

**Reporting-only expiry sync**: `syncExpiredSubscriptions()` flips
`ACTIVE` rows past their `expiresAt` to `EXPIRED` so dashboards display the
truth. This is *not* what makes access control correct — `checkVideoAccess`
already re-evaluates `expiresAt` on every check regardless of the stored
`status` — it only exists so a human reading the subscription list doesn't
see a lie. It runs opportunistically on page load today; a real scheduler
is future work (see PROJECT_STATUS.md).
