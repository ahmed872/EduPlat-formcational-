# Project Status — EduPlat (Recorded-Only Educational Platform)

Last updated: 2026-09-18 (Phase 2 session)

## Current phase

Phase 2 (Subscription & Payment System) of the master spec's execution
order is complete, on top of the Phase-1 foundation (Foundation →
Auth/Roles → Database → Teacher CMS → Courses/Lessons/Videos → Video
access/security → Subscriptions/Entitlements → Student dashboard →
Progress/Timer → Quizzes/Unlocking).

## Completed features

### Foundation
- Next.js 16 (App Router, TypeScript, React 19) modular monolith, Tailwind
  v4, RTL/Arabic-first UI (`lang="ar" dir="rtl"`), English addable later.
- PostgreSQL + Prisma 6.19.3, one migration (`20260918144836_init`) covering
  the entire data model described in DATABASE.md (~50 models spanning every
  domain in the spec, even ones whose UI/logic isn't built yet — so future
  phases add code against an already-designed schema instead of altering it
  repeatedly).
- `.env.example` documented; no secrets committed.

### Auth & roles
- NextAuth v5 Credentials provider, bcrypt password hashing, JWT sessions.
- Three roles: `STUDENT`, `PARENT`, `TEACHER_ADMIN`. Registration endpoint
  allows self-service Student/Parent signup; Teacher/Admin is seeded
  out-of-band (`npm run db:seed` creates `teacher@eduplat.local` /
  `ChangeMe123!` — **change this password before any real deployment**).
- Two-layer authorization: edge middleware (`src/proxy.ts`) + per-route
  `requireRole()` checks (`src/lib/rbac.ts`). See SECURITY.md.

### Teacher CMS (functional, not exhaustive)
- Dynamic category tree (create, nest, archive) — no hardcoded educational
  stages, matching spec section 5.
- Course create/list/publish.
- Lesson create/publish per course, with `requiredPreviousLessonId` wiring
  for sequential unlocking and a free/paid toggle.
- Subscription plan editor (`/teacher/subscriptions`): create plans, attach
  courses to a plan, activate/deactivate.
- Promo code editor (`/teacher/promo-codes`): create percentage/fixed
  discount codes and FREE_100/FREE_LESSON/FREE_PACKAGE/FREE_PERIOD codes
  (the free types require picking a linked course), usage limits,
  expiry, activate/deactivate, redemption count.
- Payment confirmation queue (`/teacher/payments`): every pending
  manual/offline payment, with one-click confirm (grants entitlements) or
  reject (cancels the subscription), plus a recent-decisions log.
- **Not yet built**: video upload UI, Shorts UI, chapters/notes editor,
  experiments editor, quiz/question-bank editor, announcements, settings
  UI. The underlying business logic and schema for several of these
  already exist and are tested (quizzes) — only the teacher-facing forms
  are pending.

### Core business rules (implemented AND tested against a real Postgres
test database — no mocks)
- **Video access / entitlements** (`src/lib/business/video-access.ts`,
  7 tests): explicit per-video `Entitlement` rows, not "subscription ⇒ all
  access"; free videos bypass the limit entirely; default 3-view limit is
  enforced (3rd view allowed, 4th blocked); a session only consumes a view
  once a configurable completion threshold (default 80%) is crossed, so
  merely opening a page never counts; newly published lessons/videos never
  leak into an existing entitlement; expired subscriptions lose access.
- **Quiz grading & lesson unlocking** (`src/lib/business/quiz.ts`, 4 tests):
  auto-grading for objective question types, manual grading for
  essay/short-answer that can flip a pending attempt to passed once
  reviewed, passing unlocks the next lesson via `requiredPreviousLessonId`,
  failing keeps it locked, `maxAttempts`/`failedAttemptConsumesAttempt` are
  enforced.
- **Study time via heartbeats** (`src/lib/business/study-time.ts`,
  5 tests): only credits time while heartbeats keep arriving within a
  30-second cadence; a pause, a backgrounded tab, or idling stops the clock
  immediately — no gap is ever backfilled; streaks require a real
  qualifying day of active time, not just a login.
- **Promo codes** (`src/lib/business/promo-code.ts`, 5 tests): valid code
  redemption, expiry, usage-limit enforcement (transactional, race-safe),
  one redemption per student per code, percentage/fixed discount math.
- **Parent access control** (`src/lib/business/parent-access.ts`) +
  **role-based guards** (`src/lib/rbac.ts`, 7 tests total across both):
  a parent can only ever read a student they are explicitly linked to; a
  student/parent calling a teacher-only or admin-only action is rejected.
- **Subscription checkout & payment states** (`src/lib/business/subscription.ts`,
  13 tests): a non-zero plan starts `PENDING_PAYMENT` with a `Payment` row
  in `PENDING` and grants **no** entitlements until a teacher/admin calls
  `confirmPayment()` (which is the only path that can mark a non-zero
  payment `SUCCEEDED` — see "Payment provider" below); rejecting a pending
  payment cancels the subscription; a payment cannot be confirmed twice;
  a `FREE_100` promo code zeroes the charge and activates the subscription
  immediately (nothing to collect, so nothing is faked); a percentage/fixed
  discount code reduces the charge but still requires manual confirmation;
  an expired/invalid promo code is rejected at checkout; refunding a
  succeeded payment cancels the subscription and revokes its entitlements;
  `FREE_LESSON`/`FREE_PACKAGE`/`FREE_PERIOD` promo codes grant entitlements
  directly (no subscription/payment at all) via
  `redeemFreeContentPromo()`/`grantEntitlementsForPromoRedemption()`, with
  `FREE_PERIOD` bounded to the academic-year-end platform setting;
  `grantAdminEntitlement()` lets a teacher explicitly unlock one lesson for
  one student outside any subscription (the escape hatch for content
  published after a student's purchase window); `syncExpiredSubscriptions()`
  flips stale `ACTIVE` rows to `EXPIRED` for display (access control itself
  never depends on this running, since `checkVideoAccess` already evaluates
  `expiresAt` dynamically).

**41/41 tests passing** (`npm test`). Full list: `src/lib/**/__tests__/*.test.ts`.

### Student dashboard
- Daily/weekly/monthly study-time summary, current streak, weekly target
  progress bar, per-course lesson list with lock/progress state.
- Video watch page: runs the real `checkVideoAccess` gate server-side,
  shows the correct denial reason (not entitled / view limit reached), and
  for allowed videos exercises the real watch-session + heartbeat APIs
  through a placeholder player control (see "Known gaps" — there is no real
  media file wired up, and the page says so instead of pretending).

### Parent dashboard
- Lists linked children (via `ParentStudent`) with aggregate study time and
  streak. No access to paid course content, per spec.

### Subscriptions & payments (Phase 2 — new this session)
- **Student** (`/student/subscribe`): browse active plans (with the
  courses each one includes, shown up front), apply a promo code inline,
  subscribe; a dedicated box to redeem a free-content code
  (`FREE_LESSON`/`FREE_PACKAGE`/`FREE_PERIOD`) independent of any plan;
  "اشتراكاتي" list showing each subscription's live status. `/student/payments`
  lists every payment with its status and amount (showing the pre-discount
  original amount when a promo reduced it).
- **Teacher/admin**: `/teacher/subscriptions` (plans + per-plan course
  membership), `/teacher/promo-codes` (create/list/toggle codes),
  `/teacher/payments` (the confirm/reject queue plus history) — see above.
- **Payment provider abstraction** (`src/lib/payments/provider.ts`): a
  `PaymentProvider` interface with two implementations today —
  `FreePaymentProvider` (amount = 0, nothing to collect, synchronous
  success) and `ManualOfflinePaymentProvider` (any non-zero amount; always
  `PENDING`, with Arabic instructions to transfer and wait for
  confirmation). **No real gateway (Stripe/PayMob/Fawry/...) is configured
  in this environment** — adding one means implementing `PaymentProvider`
  and updating `getActivePaymentProvider()`; nothing else in the checkout
  flow needs to change.

## In-progress / partially built

- Video delivery: authorization + watch-session/view-limit system is fully
  built and tested; actual signed/expiring playback URLs from a real
  storage provider (Cloudflare Stream / Mux / S3+HLS) are **not**
  implemented — no provider has been selected/configured in this
  environment. `Video.storageProvider`/`storageKey` are designed so this
  slots in without a schema change. (Phase 3 in the current plan.)

## Not started (by priority order, all schema-ready)

Shorts UI & short↔video timestamp linking, experiments UI/renderer,
student notes/bookmarks UI, teacher analytics dashboards, monthly parent
PDF reports, notifications delivery (in-app UI + the eventual
email/push hook), announcements UI, mini/daily games + leaderboards + Hall
of Fame, achievements engine, career guidance content + exploration quiz,
certificates + public verification page, referral system UI, support
ticket UI, store/checkout, real payment gateway integration, audit-log UI,
rate limiting, concurrent-session detection, video watermarking, search.

## Known gaps / honesty notes (per "no fake completion")

1. **Video playback is not wired to a real file.** The watch page tells the
   student this explicitly rather than showing a silently broken player.
2. **No real payment gateway is integrated.** The abstraction exists
   (`src/lib/payments/provider.ts`); today it only offers a manual/offline
   flow that a human must confirm — `Payment.status` never becomes
   `SUCCEEDED` for a non-zero amount without that explicit
   `confirmPayment()` call. Nothing simulates a successful charge.
3. **Parent↔student linking has no self-service UI yet** — the schema and
   access-control logic exist and are tested, but a parent currently needs
   the row created directly (e.g. by the teacher/admin) rather than through
   a request/approve flow in the product.
4. **`syncExpiredSubscriptions()` runs opportunistically on page load**
   (student/teacher subscription pages), not on a real schedule — a cron
   job or queue worker is the eventual home for it. Access control does not
   depend on this running, only the displayed `status` field does.
5. A `deepmerge-ts` advisory in Prisma's CLI tooling is open (dev-only
   dependency, not shipped to production) — see SECURITY.md for why it was
   not force-downgraded.

## Test status

```
npm test        # 41/41 passing (7 files)
npm run typecheck   # clean
npm run lint         # clean
npm run build        # succeeds
```

Manually verified in a real browser against the dev database: teacher
login → create subscription plan → attach a course → create a `FREE_100`
promo code → register a new student → subscribe with the promo code
(subscription goes `ACTIVE` immediately, payment shows `SUCCEEDED` at
0.00) → payment history reflects it correctly.

## Next recommended step

Phase 3 — Video Storage & Secure Playback: pick a concrete storage/streaming
approach (even a minimal private-bucket + short-lived signed URL scheme is
enough to replace today's placeholder), wire it into `checkVideoAccess`'s
callers so watch sessions play a real file, and add a teacher video-upload
UI. Do not restart or re-architect what exists above — extend it.
