# Project Status — EduPlat (Recorded-Only Educational Platform)

Last updated: 2026-09-18

## Current phase

Phase 1–10 of the priority order in the master spec (Foundation → Auth/Roles
→ Database → Teacher CMS → Courses/Lessons/Videos → Video access/security
→ Subscriptions/Entitlements → Student dashboard → Progress/Timer →
Quizzes/Unlocking). This is the **first implementation session**; the
repository started empty.

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
- **Not yet built**: video upload UI, Shorts UI, chapters/notes editor,
  experiments editor, quiz/question-bank editor, subscription-plan editor,
  promo-code editor, announcements, settings UI. The underlying
  business logic and schema for several of these already exist and are
  tested (quizzes, promo codes) — only the teacher-facing forms are
  pending.

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

**28/28 tests passing** (`npm test`). Full list: `src/lib/**/__tests__/*.test.ts`.

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

## In-progress / partially built

- Video delivery: authorization + watch-session/view-limit system is fully
  built and tested; actual signed/expiring playback URLs from a real
  storage provider (Cloudflare Stream / Mux / S3+HLS) are **not**
  implemented — no provider has been selected/configured in this
  environment. `Video.storageProvider`/`storageKey` are designed so this
  slots in without a schema change.

## Not started (by priority order, all schema-ready)

Shorts UI & short↔video timestamp linking, experiments UI/renderer,
student notes/bookmarks UI, teacher analytics dashboards, monthly parent
PDF reports, notifications delivery (in-app UI + the eventual
email/push hook), announcements UI, mini/daily games + leaderboards + Hall
of Fame, achievements engine, career guidance content + exploration quiz,
certificates + public verification page, referral system UI, support
ticket UI, store/checkout, payment provider integration, audit-log UI,
rate limiting, concurrent-session detection, video watermarking, search.

## Known gaps / honesty notes (per "no fake completion")

1. **Video playback is not wired to a real file.** The watch page tells the
   student this explicitly rather than showing a silently broken player.
2. **No payment provider is integrated.** `Payment.status` never becomes
   `SUCCEEDED` without a real webhook/callback — nothing simulates a
   successful charge.
3. **Parent↔student linking has no self-service UI yet** — the schema and
   access-control logic exist and are tested, but a parent currently needs
   the row created directly (e.g. by the teacher/admin) rather than through
   a request/approve flow in the product.
4. A `deepmerge-ts` advisory in Prisma's CLI tooling is open (dev-only
   dependency, not shipped to production) — see SECURITY.md for why it was
   not force-downgraded.

## Test status

```
npm test        # 28/28 passing (6 files)
npm run typecheck   # clean
npm run lint         # clean
npm run build        # succeeds
```

## Next recommended step

Build the Subscription-plan editor + checkout-stub UI in the teacher CMS
and student flow (so `grantEntitlementsForSubscription` has a real UI path
instead of only being reachable from tests), then move to the Shorts model
UI and the question-bank/quiz editor, continuing the priority order in the
master spec. Do not restart or re-architect what exists above — extend it.
