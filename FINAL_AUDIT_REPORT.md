# Final Full-System Audit, Gap Closure & Production Hardening — Report

Date: 2026-09-20
Branch: `claude/fervent-cerf-i5mcqz`
Scope: independent re-audit of all 21 originally-built phases, per the standing
"original requirements are the source of truth, prior reports are evidence
only" mandate. Nothing here treats a prior phase's own completion report,
PROJECT_STATUS.md, or test count as proof of correctness — every claim below
is backed by a file:line citation, a reproduced exploit/failure scenario, a
real test, or an explicit "verified clean" note with the evidence trail.

## Method

Ten independent audit passes were run against the live codebase (not against
documentation): eight in the first wave (auth/RBAC, video security &
entitlements, lesson gating & exams, games/leaderboard/achievements wiring,
store/promo/referral/certificates abuse, notifications/announcements/search
authorization, full Prisma schema/database integrity, and a repo-wide dead
code/placeholder/unwired-function sweep), and two more in a second wave
(parent system/reports/analytics, and career guidance/teacher
profile/support ownership) specifically to cover the subsystems the first
wave did not focus on. Every finding was independently re-verified (by
reading the cited code directly) before being acted on. Every confirmed,
fixable-in-app issue was fixed, with a new regression test — for every race
condition, the test proves the fix under genuine concurrent load
(`Promise.all`/`Promise.allSettled`) against the real Postgres test
database, not a mock. A final Playwright browser pass verified the fixes
are correctly wired end-to-end through real pages/forms, not just at the
business-logic layer.

## Executive Summary

The 21-phase build was substantially sound (no fabricated payment success,
no plaintext secrets, consistent RBAC discipline, no classic IDOR found
across dozens of checked mutations), but the audit found and fixed **six
CRITICAL** business-integrity/security bugs that a determined user could
have exploited with nothing more than direct API/server-action calls (no
timing race required for most of them), plus a further set of **HIGH** and
**MEDIUM** concurrency races and gaps. All of these are now fixed, tested,
and verified. A smaller number of **MEDIUM** feature-completeness gaps
(missing edit UI for a few schema fields, a metrics-consistency issue
between two reporting modules) were found, confirmed, and are documented
below as explicit, scoped remaining work rather than silently left as
"known gaps." Four commits (`9377212`, `1d61cdb`, `a38dea4`, `71aa679`,
plus one final commit for the E2E-discovered fix) contain every fix; the
test suite grew from 220 to 238 tests, all passing against the real
Postgres test database, and `npx tsc --noEmit`, `npx eslint .`, and
`npm run build` are all clean. A real browser-driven Playwright pass (18
end-to-end steps across registration, content authoring, sequential lesson
gating, account blocking with live-session invalidation, and rate
limiting) was run against the fixes as the mandate's required
re-audit/secondary-pass step — and it caught a sixth CRITICAL bug that the
business-logic test suite alone had missed (see below), which was fixed
and given its own regression test before this report was finalized.

**Gap-closure round (2026-09-24).** After review, seven of the twelve
remaining gaps were closed: #2, #4, #5, #6 and #7 were required, and #1
and #3 were done because they were low-risk. Each has a regression test,
and the four security- or race-related ones were also checked against
the pre-fix code, where the new tests fail. Gaps #8/#9/#10 were assessed
and deliberately left unchanged (reasons below). #11 is reclassified as
an external security enhancement and #12 stays external infrastructure.
The suite is now 270 tests (from 238), all passing. The browser E2E suite
is 26 steps, all passing: the original 18 plus 8 covering the closed
gaps. E2E also surfaced one new, rare, third-party login issue
(Auth.js `MissingCSRF` race), documented under Remaining Gaps and not
fixed, because it is outside the approved scope.

**MUST FIX / SHOULD FIX round (2026-09-25).**
- **Implemented:** content Publish/Unpublish/Archive (#47); a real
  interactive-experiment registry with server-side grading (#23, was
  PARTIAL); EXERCISE study-time protection (#13); protected lesson
  attachments (#48); certificate QR verification with revocation (#38);
  report preview + PDF (#27).
- **Correction:** row #38 previously said COMPLETE although no QR code
  existed. It was PARTIAL until this round.
- **Schema (SHOULD FIX):**
  - Real FKs for the 7 User relations and Entitlement RESTRICT (gaps #8
    and #9).
  - Typed referral columns (gap #10).
  - Every migration aborts before any DDL if the data would be orphaned
    or lose values.
- **Bugs found and fixed along the way:**
  - Subscriptions snapshotted DRAFT lessons, which leaked to old buyers
    once published.
  - Paid lesson quizzes could be started without an entitlement.
  - The notes and bookmarks APIs accepted any video.
  - The formula parser accepted prototype names.
  - The mini game's result screen was unmounted by a server revalidation
    (found by E2E).
- **Validation:**
  - `npx tsc --noEmit` and `npx eslint .` are clean, and
    `npm run build` succeeds.
  - Unit/integration tests: 417/417 (from 277).
  - A new 32-step Playwright suite, run against a production build
    (`next start`), passes 32/32. It includes direct API and
    server-action replay negatives, not just UI clicks.

## Release-Candidate Gate (2026-09-26)

**Scope.** An independent verification of the release candidate against
the code, not earlier reports. No features were added and no
architecture changed.

**Method:**
- An inventory of every entry point: 89 exported server actions (each
  checked for `auth()` + role in its own body, or in a helper it calls)
  and 17 API routes.
- Live attacks against the production build: IDOR, after-logout replay,
  concurrency, leakage, lifecycle and learning flow.
- A responsive/accessibility audit.
- A full deployment reproduced from a fresh `git clone`.

**Authorization matrix** (✔ allowed, ✘ refused; every ✘ was exercised
live or by a test):

| Surface | Guest | Student | Parent | Teacher / back office (`TEACHER_ADMIN`) |
|---|---|---|---|---|
| Public pages, shorts, teacher profile, certificate verify | ✔ | ✔ | ✔ | ✔ |
| `/student/*` pages | ✘ → login | ✔ own data only | ✘ → home | ✘ → home |
| Lesson video (URL, stream, heartbeat, notes) | ✘ 401 | ✔ only if entitled/free, published or archived-and-owned, prerequisite met, within the view limit; token bound to student + video + session | ✘ | n/a (teachers don't stream as students) |
| Quiz / experiment / attachment | ✘ | same rules as the video (`assertStudentCanUseLesson`); attachment link signed per student | ✘ | ✔ attachment download |
| Another student's notes, bookmarks, sessions, attempts, tickets, orders, notifications, certificate | ✘ | ✘ 403/404 | ✘ | ✔ where moderation needs it (tickets, orders, certificates) |
| `/parent/*` and a child's analytics/reports | ✘ | ✘ | ✔ approved-linked children only | ✘ |
| `/teacher/*` pages and all back-office actions (content status, uploads, payments confirm/reject/refund, grants, accounts, reset links) | ✘ | ✘ (action replay refused) | ✘ | ✔ audited where financial/moderation |
| Checkout | ✘ | ✔ own; duplicates, concurrent requests and an ended academic year refused | ✘ | n/a |
| Password change `/account/password` | ✘ | ✔ own (current password + lockout) | ✔ own | ✔ own |

*Ownership model:* `TEACHER_ADMIN` is the platform owner's combined
teacher/back-office role. Such accounts are created only by the seed or
the operator; self-registration allows only STUDENT/PARENT. There is
therefore no cross-teacher tenancy to enforce, and none is claimed.

**New defects found — each reproduced first, fixed, and covered by a
regression test that fails on the previous code:**

| # | Severity | Where | Reproduction | Root cause | Fix |
|---|---|---|---|---|---|
| RC1 | HIGH | `src/auth.ts` `authorize()` | 25 parallel logins for one email against the production build: all 24 wrong passwords were evaluated, and the correct one (in the burst) signed in despite the 5-per-15-min lockout | Check (`isRateLimited`), then bcrypt, then record — not atomic | `reserveLoginAttempt()`: record-as-failure under a per-email advisory lock before bcrypt. Live re-check: 5 of 25 evaluated, correct one refused. `53d4c12` |
| RC2 | MEDIUM | `src/lib/business/study-time.ts` `recordHeartbeat` | Heartbeats for 3 videos + 1 exercise every 10 s for 60 s → 240 s credited; 5 concurrent videos over 20 s → 100 s | A clock per (type, refId), not per student | One wall clock per student under an advisory lock. Live: 15.2 s → 15 s for 3 parallel videos. `fa36e9b` |
| RC3 | MEDIUM | `checkVideoAccess` (`src/lib/business/video-access.ts`) | A student entitled to lesson B, without completing lesson A, was issued a playback URL and a study-time heartbeat target for B's video | The prerequisite was enforced only by the video page and by the lesson's quiz/experiments/attachments | Video access refuses `LESSON_LOCKED`; every video path shares it. `e4bac5c` |
| RC4 | LOW | `updateTeacherProfile` | `photoUrl` of `javascript:…` / `data:…` stored and rendered as `<img src>` | No validation (social links had it) | http(s) only. `5dc7e4a` |
| RC5 | Deployment blocker | `package.json` | `npm ci` in a fresh clone → ERESOLVE | `@types/node ^20` vs vitest 5's peer `^22 \|\| >=24`; the dev install had skipped the check | `@types/node ^22` (matches the Node 22 runtime). `3d8d1a8` |
| RC6 | Deployment blocker | `src/app/shorts/page.tsx` | `npm run build` in a fresh clone without a DB → "Environment variable not found: DATABASE_URL" | The only statically prerendered DB page; it also baked build-time data | `await connection()` (per request). `817185b` |
| RC7 | LOW (dead code) | `POST /api/watch-sessions` | No caller since server-side view accounting | Left over | Removed. `5f47b4e` |
| RC8 | Docs | README, ARCHITECTURE | README was the create-next-app template recommending Vercel (unsafe with local private storage); ARCHITECTURE called the proxy edge middleware | Stale | Rewritten/corrected. `9b2ca0f` |

**Verified with no new finding:**
- **Authorization:** every server action authenticates; every
  ID-taking student/parent mutation compares ownership in the business
  layer. Live checks, each refused with the data intact: A's note or
  bookmark deleted by B (403); A's watch session patched (403); A's exam
  attempt submitted (403); A's notification marked read (unchanged, not
  listed); A's signed attachment link and video URL used by B (403); a
  video token reused on another video id (401); B's support-reply
  server action retargeted at A's ticket (0 replies).
- **Sessions:** after logout, with the old cookie put back, the page and
  RSC navigation got 307 → login; `/api/notifications`,
  `/api/playback-url` and `/api/study/heartbeat` got 401; a replayed
  server action created 0 rows. Blocked accounts, password
  reset/change, concurrent sessions, CSRF and open redirect were covered
  by the earlier suites, re-run green.
- **Video:** entitlement, publication, token binding/expiry/tampering,
  copied URLs, concurrent streams and the view-limit race, raw storage
  paths (404), and file replacement.
- **Lifecycle:** with the lesson in DRAFT, 8 student pages (dashboard,
  history, saved moments, analytics, search, video, certificates, exams)
  showed neither its title nor a result link, for an entitled student
  with notes and history. Archive keeps rows and audit history
  (status-only change).
- **Learning flow:**
  - A lesson quiz requires availability, the prerequisite and the
    required experiments.
  - Submissions must cover exactly the assigned questions; duplicates
    hit a unique constraint.
  - The deadline is checked on the server.
  - Answer keys (`correctAnswer`, `correctIndex`, experiment keys) never
    reach the browser.
- **Commerce:** all transitions are teacher-only, atomic and audited;
  promo redemption, referral rewards and certificates are unique at the
  DB level. Duplicate entitlement rows are harmless because revocation
  is by source (`updateMany` per subscription) and subscription-backed
  access also requires an ACTIVE subscription.
- **Uploads:** only 3 upload paths (video, short, attachment), all
  teacher-only, magic-byte checked, stored under random names outside
  `public/`.
- **Leakage:** 10 pages (HTML + RSC) contained no bcrypt hash,
  `passwordHash`, `tokenHash`, `storageKey`, answer key, blocked reason,
  storage path or env secret. The keyword scan found 0
  TODO/FIXME/HACK/debugger; other hits are classified as in the
  go-live round.
- **Responsive/RTL/a11y:** 23 critical pages (guest, student, parent,
  teacher) at 390, 768 and 1280 px: all HTTP 200, `dir=rtl lang=ar`,
  0 px horizontal overflow, no serious/critical axe violations (69
  renders).
- **Deployment from a fresh clone:**
  - `npm ci`, 21 migrations and the build;
  - the seed refused without credentials and created exactly 1 admin
    with them;
  - 8 unsafe configurations each exited 1;
  - journey 12/12 against the fresh install;
  - backup → restore into a new DB and directory → identical counts and
    checksums;
  - restart on the restored copy: byte-identical download, guest 401.

**Evidence (final build `9b2ca0f`):**

| Check | Result |
|---|---|
| `npx tsc --noEmit` / `npx eslint .` | clean / clean |
| `npx vitest run` | **504/504** (46 files) |
| `npm run build` | succeeds (no database needed) |
| E2E MUST FIX / journey / stress / original / CSRF | 32/32, 12/12, 10/10, 26/26, 5/5 |
| E2E password recovery / production smoke | 14/14, 19/19 |
| Release-gate attacks (new) / lifecycle leak check (new) | 11/11 / pass |
| TLS reverse proxy (nginx) | 8/8 |
| Clean-clone deployment reproduction (new) | all 13 steps pass; journey 12/12 on the fresh install |
| Responsive/a11y (new widths) | 23 pages × 3 widths clean |

## Go-Live Blocker Closure (2026-09-26)

**Scope.** This round closed the go-live blockers from the previous
audit and found no new product features to add. It was verified against
the code, not earlier summaries, and did **not** add a payment gateway,
HLS/DRM/CDN, CAPTCHA, an email/SMS provider, monitoring or a scheduler.
The subscription rules, archived-content access, `PromoCode.value`
semantics and the recorded-only scope are unchanged.

**Implemented:**
- **Password recovery and change** (#50):
  - hashed, single-use, short-lived tokens;
  - the same answer whether or not an account exists;
  - per-email rate limiting;
  - all sessions end on reset or change;
  - a development-only outbox;
  - a teacher-issued link and an operator script as the working
    production paths, because no email provider is integrated.
- **Session invalidation that holds** (#56): every protected request is
  re-checked, and sign-out is revoked server-side.
- **Fail-closed production configuration** (#57): an https `AUTH_URL`
  and `STORAGE_ROOT` are required. TLS through nginx was verified.
- **Upload content validation and safe file replacement** (#58).
- **Atomic payment decisions** (#59).
- **RFC-compliant byte ranges** (#60).
- **DEPLOYMENT.md rewritten:** topology, the tested proxy config, storage
  setup, backup frequency/retention/verification, the smoke checklist,
  and payment-gateway prerequisites.

**Real defects found and fixed.** Each was reproduced first and has a
regression test.

| # | Finding | Severity | Found by | Fix / commit |
|---|---|---|---|---|
| G1 | **Blocked or invalidated sessions could still read protected pages.** `proxy.ts` accepted any correctly signed JWT, and ~35 pages rely on their layout for the auth check. A client-side navigation re-renders only the page segment, not the layout. Replaying a captured navigation request for `/student/hall-of-fame` after blocking the student returned **200 with the page**. After a password reset, a stolen teacher session could have read `/teacher/accounts`, `/teacher/payments`, … the same way. | HIGH | repro script | The proxy uses the full auth instance and re-checks the account on every protected request. The replay now gets 307 → `/login`. `0b4107c` |
| G2 | **Sign-out did not sign out** (pre-existing). The auth middleware re-issues the session cookie on every response, and link prefetches in flight at sign-out came back after the cookie was deleted and re-created it: 8 such responses in one trace, and `/student` still returned 200. On a shared computer the next person kept the previous user's session. | HIGH | smoke S6 | Per-session id in the JWT, revoked server-side on sign-out (`RevokedSession`). Other devices stay signed in. `2602593` |
| G3 | **Payment reject/refund were not atomic.** A reject racing a confirm both succeeded, leaving a FAILED payment and a CANCELLED subscription after access was granted; two refunds were both recorded. | MEDIUM | new race test (failed 2/2 before the fix) | Conditional claims like `confirmPayment`. `4bbb00f` |
| G4 | **No password recovery at all** (previous blocker #50). | Blocker | audit | `ab12a7a` |
| G5 | **Login followed any `?callbackUrl=`**, including `https://evil.example` (open redirect). | MEDIUM | code review | Same-origin paths only. `ab12a7a` |
| G6 | **Byte ranges:** an end past the file got 416 instead of the remaining bytes (a player's final chunk), and `bytes=-500` returned the *first* 501 bytes. | MEDIUM | smoke S2 | RFC 9110 handling. `cbd9cc4` |
| G7 | **Uploaded videos trusted the browser-declared type and the client's file extension.** No magic-byte check; the stored extension came from the filename. | LOW (teacher-only) | storage audit | Container detection; extension taken from the content. `1ffe95e` |
| G8 | **Replacing a lesson video deleted the old file before updating the row**, so a failed update left a dangling key. Replacing also silently **re-published** a draft or archived video. A failed short insert left an orphaned file. | LOW | storage audit | Update first, delete after; status kept; cleanup on failure. `1ffe95e` |
| G9 | **Production accepted unsafe configuration:** `AUTH_TRUST_HOST` without `AUTH_URL` made cookie security and redirects depend on proxy headers; `STORAGE_ROOT` could be unset or under `public/`. The storage probe also created directories under a rejected root. | MEDIUM | config audit | Fail closed. `f0185f8` |
| G10 | **Documented nginx example broke shorts uploads over 30 MB**; the sign-in rate limit also covered `/api/auth/session`, and there was no HTTP→HTTPS redirect. | LOW (docs) | TLS test | DEPLOYMENT.md §5 replaced by the tested config. |
| G11 | `rate-limit` race in the new reset-request limiter: 4 of 10 concurrent requests passed a limit of 3. | caught before commit | own test | Window query without an upper bound. `ab12a7a` |

**Payment model verification** (kept as manual/offline, #59):
- Students are told payment is manual, and no UI implies a gateway.
- Transitions happen only in teacher-only server actions: `requireRole`
  + proxy.
- The amount comes from the plan on the server; the client never sends
  it.
- A student can't confirm a payment: the actions refuse and the proxy
  redirects.
- Access is granted only by `confirmPayment`. Subscription-backed
  entitlements also require the subscription to be ACTIVE, so even a
  late grant after a refund gives no access.
- Every decision writes an AuditLog row.
- Duplicate and concurrent checkouts are refused (5 parallel → 1), and
  so is a checkout after the academic-year end.

**Repository keyword review** (TODO, FIXME, HACK, temporary,
placeholder, mock, fake, dummy, test password, default password,
console.log, secret, token, password, unsafe, bypass):

| Hits | Classification |
|---|---|
| TODO / FIXME / HACK / temporary / dummy / default password: 0 | — |
| `placeholder` (52): HTML input placeholders; `Video.storageProvider @default("PLACEHOLDER")` (the upload always sets `LOCAL_PRIVATE`) | intentional |
| `mock` / `unsafe` / `fake` in tests; `$executeRawUnsafe` only in the test DB reset | test-only |
| `fake` (2) and `bypass` (5) in app code: comments explaining what is prevented | documentation |
| `console.log` (6): startup "checks passed", seed output (prints the development password only outside production, never an env password), the operator reset-link script (prints to the operator's terminal by design) | intentional |
| `secret` (16): `AUTH_SECRET` read for HMAC signing, and env validation (messages never include values) | intentional |
| `token` / `password` (~360): auth, signed playback/download tokens, reset tokens, password policy; no token, password or email is logged anywhere (grep of every `console.*` call) | intentional |
| `.env.example` placeholder secret | documentation (production startup refuses it) |

Also checked:
- **XSS:** 2 `dangerouslySetInnerHTML`, both locally generated QR SVGs.
- **SQL injection:** no unsafe raw SQL in app code.
- **SSRF:** no server-side outbound `fetch`.
- **Stored external URLs:** career resources and social links are
  validated (existing tests).

**Accepted residual risks:**
- **Registration reveals whether an email is registered** (409). This is
  inherent to self-registration. It is mitigated by the proxy rate limit
  on `/api/auth/register`, and the reset flow itself does not reveal it.
- **Revoked sessions are checked against the database on every protected
  request** (two indexed lookups) — by design.

**Evidence (final build, 2026-09-26):**

| Check | Result |
|---|---|
| `npx tsc --noEmit` / `npx eslint .` | clean / clean |
| `npx vitest run` | **496/496** (46 files) |
| `npm run build` | succeeds |
| E2E MUST FIX / journey / stress / original / CSRF | 32/32, 12/12, 10/10, 26/26, 5/5 |
| E2E password recovery (new) | **14/14** |
| Production smoke (new) | **19/19** |
| TLS reverse-proxy check (nginx, new) | **8/8** |
| Production startup matrix | 4 unsafe configs → exit 1; complete config → healthy |

## Production Readiness & Deployment Audit (2026-09-25)

**Method.** The MUST FIX claims were re-checked against the code,
migrations and tests themselves, not earlier summaries. On top of that:
- a fresh production-like deployment on an empty database;
- an upgrade of a populated copy of the pre-release schema, plus
  backup/restore of the real development database;
- full role journeys and HTTP-level attack/concurrency runs against a
  production build (`next start`);
- a 390 px mobile + axe-core audit;
- latency measurements.

All 21 phases still have live routes in the production build, and a scan
found no live-streaming or real-time code, so the recorded-only scope is
intact.

**Real defects found and fixed in this round**, each with a regression
test that fails on the previous code:

| # | Finding | Severity | Fix / commit |
|---|---|---|---|
| 1 | The paid-video **view limit was still client-trusted**. Consumption only happened when the player reported progress, so a client that skipped the progress call (or inflated `videoDurationSeconds`) could stream a 3-view video without limit. Reproduced: 6 full streams, 0 views consumed. The previous "COMPLETE" row #12 was wrong. | CRITICAL | Tokens are bound to a watch session, and the stream route counts delivered bytes. `d5b1025` |
| 2 | Concurrent sessions could exceed the view limit. The old "concurrency" test ran sequentially. | HIGH | Per-student+video advisory lock; the new test fails 3/3 without it. `d5b1025` |
| 3 | The final paid view was cut off: after the last view was consumed at 80%, the remaining 20% was refused. | MEDIUM | The session holding the consumed view may finish. `d5b1025` |
| 4 | The seed created a **default admin password** (`ChangeMe123!`) in every environment, including production, and printed it. | CRITICAL (deployment) | The production seed requires `SEED_TEACHER_*`, never prints it, and is idempotent. `52a5bd9` |
| 5 | No startup validation. Missing `AUTH_TRUST_HOST` made every login fail with `UntrustedHost`; a weak `AUTH_SECRET` and unwritable storage went undetected; private files were world-readable (755/644). | HIGH (deployment) | Fail-fast checks, `STORAGE_ROOT`, 700/600 permissions. `52a5bd9` |
| 6 | Checkout sold **already-expired subscriptions** once the academic-year end had passed, and a replayed or parallel checkout opened duplicate pending subscriptions, each of which could be confirmed and collected. | HIGH (money) | Refused before any promo or payment is recorded; advisory lock. `da86c79` |
| 7 | Students were never told payment is manual/offline, because the provider's instructions were discarded. | MEDIUM | Explicit manual-payment notices and payment-method column. `d9f4427` |
| 8 | Teacher analytics overview: about 3 queries per student per course (6,120 queries / 2.8 s at 2,000 students). | HIGH (performance) | Batched: 140 queries / 183 ms, with identical numbers. `f27acbc` |
| 9 | No security headers, no Arabic error/404 pages, and `X-Powered-By` exposed. | MEDIUM | Headers, error, global-error and not-found pages. `fb7da8d` |
| 10 | Mobile layouts were broken: every student page was 981 px wider than a phone, and teacher pages overflowed by up to 699 px. There were also serious axe contrast/ARIA issues. | HIGH (usability) | Responsive layouts; AA contrast. `fb7da8d` |
| 11 | No health endpoint for load balancers or uptime checks. | LOW | `/api/health` (DB ping, no details leaked). |

**Evidence (final run on the release build):**
- **Fresh deployment:** 19 migrations applied to an empty DB.
- **Production seed:** refuses without credentials and is idempotent with
  them.
- **Startup refusals:** exit 1 for a missing `AUTH_TRUST_HOST`, a weak
  secret, and unwritable or hanging storage. No secret appeared in any
  log.
- **Private files:** persist byte-identical across a restart; anonymous
  requests are refused.
- **Populated upgrade** (2,002 users / 5,000 entitlements / 20,000 watch
  sessions / 1,500 float referral rewards):
  - the 6 pending migrations applied in 1.85 s;
  - all counts and the reward-day total were identical before and after;
  - the type conversions and back-fills were correct.
- **Forced migration failure:** an injected orphaned teacher id made the
  migration abort before any DDL. Data repair + `prisma migrate resolve
  --rolled-back` + redeploy then succeeded with all rows preserved.
- **Backup/restore:** `pg_dump -Fc` → `pg_restore` of the development
  database gave identical counts across 9 tables.
- **Playwright on `next start`:**

  | Suite | Result | Covers |
  |---|---|---|
  | MUST FIX | 32/32 | MF#1–#5 and the schema checks |
  | Full role journey | 12/12 | guest → teacher → student manual payment → teacher confirmation → playback, server view limit, credited study time, experiment, quiz, certificate QR → parent report PDF → refund cutting a live playback URL |
  | HTTP stress | 10/10 | replayed/parallel checkout, a student replaying the teacher's confirm action, 5× parallel confirm, 10 parallel playbacks, copied/forged links, raw paths, cross-account access, academic-year-ended checkout, forged heartbeats |
  | Original targeted | 26/26 | |
  | Fresh-browser CSRF login | 5/5 | |

- **Mobile/accessibility:** 21 critical pages across 4 roles at 390 px
  show 0 px horizontal overflow, `dir=rtl` and no serious or critical
  axe violations.
- **Latency** (single process, 10 concurrent, p95): public pages ≤ 156 ms,
  student dashboard 203 ms, teacher payments 209 ms. Teacher analytics
  measured 1,085 ms before batching.

**Owner decisions / external providers still required** (details in
DEPLOYMENT.md §11–12):
1. **Password recovery does not exist** for any role (#50). Choose email
   reset (needs a provider), an admin-initiated reset, or manual
   operator resets.
2. **Payments are manual/offline** (#49). Launching this way is supported
   and clearly labelled; an online gateway needs a merchant account and
   integration.
3. **Infrastructure** the owner must provide: TLS domain + reverse proxy
   (body-size and rate limits), production Postgres with scheduled
   backups and a test restore, and a persistent `STORAGE_ROOT` volume.
4. **Video delivery at scale** (#14): no transcoding/HLS/CDN/DRM. Teachers
   must upload H.264/AAC MP4, and bandwidth goes through the app server.
5. **Optional:** CAPTCHA (#53), scheduled jobs (#52), email/SMS
   notifications (#51), a script-src CSP with nonces, and horizontal
   scaling (needs shared/object storage).

## Requirements Coverage

Legend (re-baselined 2026-09-25 against the code, tests and a production
build — not against earlier summaries):
- **VERIFIED**: implementation, runtime wiring, authorization and
  negative cases are present, with passing tests against the real
  Postgres database. Where the E2E column says Yes, it was also exercised
  in a browser against `next start` in the final run.
- **PARTIAL**: works for the primary path, with a named gap.
- **BLOCKED**: a launch prerequisite that only the owner can supply
  (infrastructure or a decision). Nothing in the code can close it.
- **EXTERNAL DEPENDENCY**: needs a third-party provider that is not
  integrated. The code stops at a documented seam and nothing is faked.
- **NOT IMPLEMENTED**: does not exist.

Re-baselined again on 2026-09-26 (go-live blocker round): rows 49–53
were reclassified, row 50 was implemented, and rows 56–62 were added.

| # | Requirement | Status | Evidence | Tests | E2E | Remaining |
|---|---|---|---|---|---|---|
| 1 | Registration / login / logout / bcrypt hashing | VERIFIED | `src/auth.ts`, `src/app/api/auth/register/route.ts` | Yes | Yes | — |
| 2 | Role-based access control (STUDENT/PARENT/TEACHER_ADMIN), two-layer (edge `proxy.ts` + per-page/action) | VERIFIED | `src/lib/rbac.ts`, `src/proxy.ts`, verified across 25+ actions | Yes | Yes | — |
| 3 | Blocked-user enforcement, including an *already-logged-in* session | VERIFIED (fixed this audit) | `src/auth.ts` session callback now re-checks live DB status on every session read | New test needed at E2E layer only (business logic covered) | Yes | — |
| 4 | Login rate limiting / brute-force throttling | VERIFIED — **RC gate correction:** parallel guesses bypassed the lockout (24 of 25 evaluated, correct password accepted); fixed with an atomic reservation `53d4c12`, re-verified live (5 of 25) | `src/lib/business/security.ts` | Yes | Yes | — |
| 5 | Audit log for sensitive actions (payments, blocking) | VERIFIED | `src/app/teacher/audit-log/page.tsx` | Yes | Yes | — |
| 6 | Dynamic category/course/lesson hierarchy (no hardcoded stages) | VERIFIED | `Category` is self-referential in schema; teacher CRUD confirmed generic | Yes (Foundation-era) | — | — |
| 7 | Subscription/payment state machine, no fake payment success (manual/offline payment workflow) | VERIFIED (manual/offline only; no gateway) | `src/lib/business/subscription.ts`, `src/lib/payments/provider.ts` (`MANUAL_OFFLINE`); checkout now refuses duplicate open subscriptions and dead-on-arrival (academic-year-ended) purchases; student UI labels the payment as manual and states that nothing is charged online | Yes (`security-stress.test.ts`: replay/parallel checkout, concurrent confirm) | Yes (journey S2/S3: pending → teacher confirms → ACTIVE + audit; stress X1–X3, X8) | Online gateway: see #49 |
| 8 | Future-published content does not leak into an existing subscription | VERIFIED (tightened in MF round) | `grantEntitlementsForSubscription` / promo grants snapshot only `PUBLISHED_LESSON_WHERE` lessons at purchase time (they previously also snapshotted DRAFT lessons, which then leaked to old buyers when published); `grantLessonToCourseSubscribers` batch grant is the explicit teacher-driven path | Yes (`content-visibility.test.ts`) | Yes (batch grant + audit log) | — |
| 9 | Manual/offline payment confirm + **refund** | VERIFIED (refund UI was dead, now wired) | `src/lib/business/subscription.ts` (`refundPayment`), `src/app/teacher/payments/page.tsx` | Yes | Yes | — |
| 10 | Admin one-off entitlement grant (bonus lesson after purchase window) | VERIFIED (was dead, now wired) | `src/lib/business/video-access.ts` (`grantAdminEntitlement`), new `src/app/teacher/entitlements/page.tsx` | Yes | Yes | — |
| 11 | Private video storage, signed/expiring playback URL, per-request re-authorization, **session binding** | VERIFIED (session binding fixed in gap round — gap #2) | `src/app/api/stream/[videoId]/route.ts` (session must match token's studentId, unconditionally) | Yes (no-cookie / other-student / blocked → 403) | Yes | — |
| 12 | **Three-view rule**, server-authoritative, cannot be bypassed via direct API | VERIFIED (**re-fixed 2026-09-25** — it was still client-trusted) | `src/app/api/stream/[videoId]/route.ts` + `recordDeliveredRange` / `consumeViewIfWithinLimit` in `src/lib/business/video-access.ts`: tokens are bound to a watch session; views are counted from bytes the server actually delivered; per-student+video advisory lock; the session holding the last view may finish | Yes (`view-accounting.test.ts`: fails on old code — 6 full streams with 0 views consumed; concurrent consumption fails 3/3 without the lock) | Yes (journey L4; stress X4: 10 parallel playbacks → exactly 3 views) | For very small files, browser prefetch can count a view at playback start (documented) |
| 13 | Actual (not just opened-page) study-time tracking, heartbeat abuse resistance — VIDEO and EXERCISE | VERIFIED — **RC gate correction:** parallel activities multiplied real time (60 s credited as 240 s); fixed with one wall clock per student `fa36e9b`, re-verified live (15.2 s → 15 s) | `src/lib/business/study-time.ts` (`assertHeartbeatTargetIsReal`); `experiment-runner.tsx` sends only while visible + interacting | Yes | Yes (journey L2: exercise and video time credited in `DailyStudyStat` and carried into the parent report; MF2-h/i; stress X9 forged heartbeats refused) | — |
| 14 | HLS/DASH/DRM/CDN/transcoding | EXTERNAL DEPENDENCY (external infrastructure — not implemented in-app) | `StorageProvider` seam only; progressive MP4 via range requests today | — | — | Needs a video platform or object storage + CDN; see DEPLOYMENT.md §11. Nothing is claimed. |
| 15 | Shorts (public, free, linked to source video+timestamp) | VERIFIED | `src/lib/business/shorts.ts` | Yes | — | — |
| 16 | Sequential lesson gating (video → required experiments → quiz → next lesson), server-side | VERIFIED — **RC gate correction:** the video APIs (playback URL, stream, heartbeat, notes) did not check the prerequisite; fixed in `checkVideoAccess` `e4bac5c` | `src/lib/business/quiz.ts` (`startQuizAttempt` now calls `canAccessLesson`; `canAccessLesson` itself fixed again after E2E caught `isFree` bypassing the prerequisite gate entirely) | Yes | Yes | — |
| 17 | Question bank: MCQ/True-False/multi-select/matching/short-answer/essay | VERIFIED | `prisma/schema.prisma` `QuestionType`, `src/lib/business/quiz.ts` | Yes | — | — |
| 18 | Random/fixed question selection, consistent across serve/validate/score | VERIFIED | `src/lib/business/quiz.ts` | Yes | — | — |
| 19 | Exam time limit and availability window enforced **server-side** | VERIFIED (test coverage **added 2026-09-25** — the claim previously had none) | `src/lib/business/quiz.ts` (`submitQuizAttempt` grades a late submission as zero) | Yes (`security-stress.test.ts`: past time limit + grace → 0 points; inside → graded; concurrent double submit → one answer set) | — (API ownership check covered by route + stress X7) | — |
| 20 | Manual grading, correctness, point bounds | VERIFIED (bound-clamp fixed this audit) | `src/lib/business/quiz.ts` (`gradeManualAnswer`) | Yes | — | — |
| 21 | Answer-coverage integrity (cannot omit hard questions to inflate score) | VERIFIED (fixed this audit — was CRITICAL) | `src/lib/business/quiz.ts` (`submitQuizAttempt` requires full coverage) | Yes | — | — |
| 22 | Quiz attempt-limit cannot be bypassed by abandoning attempts | VERIFIED (fixed this audit) | `src/lib/business/quiz.ts` (only one IN_PROGRESS attempt at a time, auto-expiry) | Yes | — | — |
| 23 | Interactive experiments: extensible type registry — drag & drop, interactive activity (ordering), mini game, template simulation — each with config schema, teacher editor, student renderer, server-side grading | VERIFIED (MF round; was PARTIAL) | `src/lib/experiments/definitions.ts` (registry, `toPublicExperiment`, `gradeSubmission`, `applyMiniGameMove`), `expression.ts` (safe evaluator), `src/lib/business/experiment.ts` (auth + entitlement + publication + prerequisite + ownership on start/submit/move), teacher `experiment-editor.tsx`, `renderers/*` | Yes (37 business + 29 registry unit tests: `[]`/partial/foreign attempt/out-of-range/late/concurrent moves, answer key never in the public view) | Yes (all four types played in the browser; direct server-action replays rejected; answer key absent from HTML) | Legacy step-list experiments still run (require every step) and are labelled as legacy in the editor |
| 24 | Student/course/teacher analytics, correct enrollment definition (incl. free content) | VERIFIED (teacher overview **batched 2026-09-25**) | `src/lib/business/analytics.ts` — teacher course analytics now a fixed number of queries (2,000 students × 20 courses: 6,120 queries/2.8 s → 140 queries/183 ms) | Yes (equivalence test vs single-student computation; fails on old code) | Yes (journey P1 parent analytics page) | — |
| 25 | Parent-student linking (request/approve/reject), **revoke** | VERIFIED (revoke was missing, now added this audit) | `src/lib/business/parent-link.ts`, new "إلغاء الربط" button on `/student/parent-requests` | Yes | Yes | — |
| 26 | Parent access strictly scoped to approved links, never to paid content | VERIFIED | `src/lib/business/parent-access.ts`, verified no bypass across 3+ consumers | Yes | Yes | — |
| 27 | Parent reports (study time/tests/lessons/experiments), real snapshot data, consistent with analytics — with preview + PDF download | VERIFIED (PDF flow added in MF round) | `src/lib/business/reports.ts` (`getReportForViewer` gate), printable `/parent/students/[id]/reports/[reportId]` and `/teacher/reports/[reportId]` with Download/Print-to-PDF (browser print engine, A4 print CSS) | Yes (incl. report == analytics cross-check; 7 authorization tests) | Yes (PDF produced and its text checked for shaped Arabic, the student and no app chrome; unlinked parent / wrong-student URL / student / anonymous refused) | Automatic scheduled generation — see #28 |
| 28 | Reports manual vs. automatic (spec allowed either; scheduler unavailable) | PARTIAL, honestly | `src/app/teacher/reports/actions.ts` | Yes | — | 100% teacher-triggered; no cron/scheduler exists in this environment (documented, not hidden) |
| 29 | Promo codes (percent/fixed/100%/free lesson/package/period), abuse resistance | VERIFIED (usage-limit race fixed this audit) | `src/lib/business/promo-code.ts` | Yes, incl. concurrency test | — | — |
| 30 | Marketing banners | VERIFIED | `src/lib/business/marketing.ts` (Phase 11) | Yes | — | — |
| 31 | Mini game (~5 min, hourly) / Daily game (~10 min, opening time, once/day) as distinct behaviors | VERIFIED (gap round — gap #5) | `src/lib/business/games.ts`: server-side duration deadline on submit; MINI once per `miniCooldownMinutes` window via real `@@unique([gameId, studentId, cooldownBucket])`; DAILY_MAIN opening time + once/day | Yes (incl. stale-read race + late-submit tests) | Yes | Game settings are set at creation; there is no edit form for an existing game (pre-existing, not part of the gap) |
| 32 | Game score integrity (server-authoritative, not client-trusted) | VERIFIED (fixed this audit — was CRITICAL) | `src/lib/business/games.ts` (`submitGameScore` recomputes from real answers; answer key never sent to client) | Yes, incl. an "oversized forged answers" test | Yes | — |
| 33 | Daily-game "one play per day" cannot be bypassed by a race | VERIFIED (fixed this audit) | Real `@@unique([gameId, studentId, playDate])` constraint | Yes | — | — |
| 34 | Leaderboards (daily/weekly/monthly), best-score-per-student, no stale cache | VERIFIED | `src/lib/business/leaderboard.ts` | Yes | Yes | — |
| 35 | Hall of Fame, teacher-approval-gated, no unauthorized approval | VERIFIED | `src/lib/business/leaderboard.ts`, `src/app/teacher/hall-of-fame/actions.ts` | Yes | Yes | — |
| 36 | Achievements/streaks, all triggers wired, no duplicate-award race | VERIFIED (race fixed this audit) | `src/lib/business/achievements.ts` | Yes | Yes | — |
| 37 | Career guidance (honest suggestions, teacher-managed fields incl. roadmap/resources) | VERIFIED (gap round — gap #6) | `src/lib/business/career-guidance.ts` (`updateCareerField` keeps id+slug; roadmap/resources with http(s)-only URLs) | Yes | Yes | — |
| 38 | Certificates (eligibility, no duplicate issuance, public verification, **QR**) | VERIFIED (MF round). **Correction:** this row previously read COMPLETE although no QR code existed — it should have been PARTIAL until this round | `src/lib/business/certificates.ts` (`verifyCertificate`, `certificateQrSvg` via local `qrcode` library, `revokeCertificate`/`restoreCertificate`), public `/certificates/verify/[code]`, printable `/student/certificates/[id]` | Yes (21 tests: malformed/tampered/internal-id codes, revoked/restored, reason never public, audit log) | Yes (QR decoded from rendered pixels → exact public URL; valid / not-found / invalid / revoked shown without login; other student 404) | — |
| 39 | Referral (valid/invalid/self/duplicate, real-conversion-only reward) | VERIFIED ($0-checkout gate fixed this audit) | `src/lib/business/referral.ts` | Yes | Yes | No anti-fake-account friction exists (honestly pre-documented in code, not hidden) |
| 40 | Teacher profile (bio/education/experience/social links/contact/locations+schedule) | VERIFIED — **RC gate correction:** `photoUrl` accepted javascript:/data: values; now http(s) only `5dc7e4a` | `src/lib/business/teacher-profile.ts`, `/teacher/profile`, public `/teachers/[teacherId]` | Yes (incl. javascript:/malformed rejection) | Yes | — |
| 41 | Support tickets (student/parent/teacher, ownership, statuses) | VERIFIED (authorization + notification gaps fixed this audit) | `src/lib/business/support.ts` | Yes | Yes | — |
| 42 | Store (products/orders/states/authorization), no fake payment success | VERIFIED (stock race fixed this audit) | `src/lib/business/store.ts` | Yes, incl. concurrency test | Yes | — |
| 43 | Notifications (lesson-unlock, subscription-activated, target-reached, achievement, support-reply) | VERIFIED (TARGET_REACHED race closed in gap round — gap #3) | `src/lib/business/notifications.ts` (real `@@unique([userId, dedupeKey])`) | Yes (stale-read race test) | Yes | — |
| 44 | Announcements (ALL/STUDENT/COURSE/CATEGORY, never GROUP, correct targeting) | VERIFIED | `src/lib/business/announcements.ts` | Yes | — | — |
| 45 | Global search, never leaks unpublished/draft/private data to students | VERIFIED | `src/lib/business/search.ts` | Yes | Yes | — |
| 46 | Database integrity (constraints, indexes, cascade/restrict behavior, real FKs) | VERIFIED (FKs + RESTRICT + referral types added in MF round) | Migrations `20260925030000_user_relation_foreign_keys` (7 User FKs + Entitlement lesson/video RESTRICT) and `20260925040000_referral_reward_types`, each with an abort-before-DDL preflight | Yes (`schema-constraints.test.ts`) | Yes (DB refuses deleting an entitled lesson / a teacher with courses; constraints verified) | `PromoCode.value` intentionally unchanged (product decision) |
| 47 | Course / lesson / video Publish · Unpublish · Archive, enforced everywhere | VERIFIED (MF round) | `src/lib/business/content-visibility.ts` (effective state over video→lesson→course), `content-status.ts`, teacher `StatusControls`; applied to dashboard, video page, search, stream, notes/bookmarks, heartbeat, quizzes, experiments, attachments, grants | Yes (16 visibility tests + route/quiz/experiment/attachment tests) | Yes (unpublish hides from holder incl. direct APIs; re-publish restores; archive keeps holders, blocks others/search/new grants; archived free lesson no longer free; video-only unpublish) | — |
| 48 | Lesson attachments / PDF with protected download | VERIFIED (MF round) | `src/lib/business/attachments.ts` (magic-byte validation, signed 10-min token bound to student+attachment), `/api/attachments/[id]`, private `storage/attachments/` | Yes (25 tests incl. swapped id, video token reuse, revoked entitlement, unpublished course, traversal keys, header injection) | Yes (upload + spoofed/disallowed files rejected; download bytes checked; anonymous / other student / swapped id / forged token / raw path refused; unpublish revokes an issued link) | — |
| 49 | Real online payment gateway | EXTERNAL DEPENDENCY (the manual/offline flow is VERIFIED; see #59) | `PaymentProvider` seam in `src/lib/payments/provider.ts`; only `MANUAL_OFFLINE` and zero-amount `FREE` exist | — | — | Owner decides whether to launch with manual payments; see DEPLOYMENT.md §11 |
| 50 | Password recovery / change (any role) | VERIFIED (2026-09-26) | `src/lib/business/password-reset.ts` (SHA-256-hashed single-use tokens, 30 min self-service / 4 h teacher-issued, atomic claim, superseded by newer, blocked accounts refused, `sessionVersion` bump), `/forgot-password`, `/reset-password` (token in the URL fragment), `/account/password`, teacher-issued link in `/teacher/accounts`, `npm run password:reset-link` | Yes (`password-reset.test.ts`, forgot-password action tests, proxy tests) | Yes (`e2e_password` 14/14) | Self-service links are **not delivered** in production: email/SMS is an EXTERNAL DEPENDENCY (#51). Working production paths: the teacher-issued link, and the operator script for the teacher account. |
| 51 | Email / SMS delivery | EXTERNAL DEPENDENCY | `notify()` writes in-app notifications only | Yes (in-app) | Yes (in-app) | Hook point: `notify()` |
| 52 | Scheduled jobs (subscription status sync, automatic reports) | EXTERNAL DEPENDENCY (no scheduler in repo; not needed for access correctness) | Access checks evaluate expiry live; `syncExpiredSubscriptions` runs on page loads | Yes | — | Optional cron; not required for access correctness |
| 53 | CAPTCHA on registration | EXTERNAL DEPENDENCY (optional; out of scope this round) | — | — | — | Mitigated by proxy rate limits (DEPLOYMENT.md §5) |
| 54 | Deployment safety: env validation, startup checks, private storage persistence/permissions, migrations on fresh and populated DBs, backup/restore, failure recovery, health endpoint | VERIFIED — **RC gate correction:** a clean clone failed `npm ci` (ERESOLVE) and `npm run build` needed a database; fixed `3d8d1a8`, `817185b`, then reproduced end to end from a fresh clone | `src/instrumentation.ts`, `src/lib/startup.ts`, `src/lib/env.ts`, `STORAGE_ROOT`, `/api/health`, guarded migrations, production seed guard | Yes (`env.test.ts`, health route tests) | Yes (fresh-DB deploy + restart persistence; populated-DB upgrade; forced failure + `migrate resolve` recovery; dump/restore) | Backups must be scheduled by the owner |
| 55 | Security headers, Arabic error/404 pages, mobile RTL layout, accessibility on critical journeys | VERIFIED (2026-09-25) | `next.config.ts` headers, `src/app/error.tsx` / `global-error.tsx` / `not-found.tsx`, responsive layouts | — | Yes (21 pages at 390 px: 0 px overflow, no serious/critical axe violations; error page shown on a refused action) | script-src CSP not restricted (needs nonces) |
| 56 | Session invalidation: blocked accounts, password reset/change, sign-out, client-side navigation | VERIFIED (2026-09-26) | `src/proxy.ts` (live account check on every protected request), `session-validity.ts` (`sessionVersion`, `RevokedSession`), `src/lib/actions/sign-out.ts` | Yes (`proxy.test.ts`, `password-reset.test.ts`) | Yes (blocked session's replayed navigation → 307; after a reset both earlier devices signed out; pre-logout cookie replayed after sign-out → refused) | — |
| 57 | Production configuration fails closed; HTTPS behind a TLS-terminating proxy | VERIFIED (2026-09-26) | `src/lib/env.ts` (https `AUTH_URL` and `STORAGE_ROOT` required, `STORAGE_ROOT` never in `public/`), `src/lib/startup.ts`, DEPLOYMENT.md §5 | Yes (`env.test.ts`) | Yes (4 bad configs exit 1; nginx TLS run: `__Secure-`/`__Host-` cookies, HSTS, spoofed Host ignored, 429 on sign-in bursts, 413 over the body limit) | The owner's real domain, certificate and proxy (#61) |
| 58 | Upload validation and safe file replacement | VERIFIED (2026-09-26) | `src/lib/business/video-upload.ts` (container magic bytes; stored extension from content), video replace updates the row before deleting the old file, keeps the video's status | Yes (`video-upload.test.ts`) | Yes (all suites upload through the UI) | — |
| 59 | Manual/offline payment workflow integrity | VERIFIED (2026-09-26) | Teacher-only confirm/reject/refund, each an atomic conditional transition with an AuditLog row; checkout guarded against duplicates and an ended academic year; UI states payment is manual | Yes (`security-stress.test.ts` incl. confirm-vs-reject and double-refund races) | Yes (journey S2/S3/R1; smoke X5: 5 parallel checkouts → 1 PENDING `MANUAL_OFFLINE` payment) | Online gateway is #49 |
| 60 | HTTP byte-range compliance for video/short streaming | VERIFIED (2026-09-26) | `resolveRange` in `src/lib/http/range-stream.ts` | Yes (`range-stream.test.ts`) | Yes (smoke S2/G1) | — |
| 61 | Production infrastructure: domain + TLS proxy, managed Postgres with scheduled backups and a test restore, persistent `STORAGE_ROOT` volume | BLOCKED (owner) | Procedures in DEPLOYMENT.md §3–§8, tested here with nginx + self-signed TLS and local Postgres | — | — | **Launch blocker** |
| 62 | Monitoring / alerting | EXTERNAL DEPENDENCY | `/api/health`, JSON error lines | Yes | Yes | Recommended before launch |

## Critical Bugs Found

1. **Three-view-rule bypass** — the paid-content view limit was only checked
   when a `WatchSession` was *created*, never when a view was actually
   *consumed*. Opening several sessions before consuming any of them let
   every one flip to consumed independently, defeating the platform's core
   content-protection feature via ordinary API calls, no race required.
2. **Quiz score-coverage gap** — submitting only a subset of assigned
   questions (omitting hard/manual ones) inflated the score to 100% and
   skipped manual grading entirely.
3. **Quiz lesson-sequence bypass** — a student who obtained a later lesson's
   `quizId` could start and pass it directly, unlocking every downstream
   lesson without ever completing the prerequisite chain.
4. **No server-side exam time-limit enforcement** — `timeLimitMinutes` and
   the exam's availability window were enforced client-side/at-start only;
   a direct call to the submit endpoint accepted an arbitrarily late
   submission at full credit.
5. **Game score was 100% client-trusted, and the answer key was sent to the
   browser in full** — a single forged request could top every leaderboard
   and Hall-of-Fame ranking and unlock every points-based achievement.
6. **`canAccessLesson`'s `isFree` short-circuit bypassed the sequential
   lesson-unlock requirement entirely** (found by the Playwright E2E pass,
   not the unit-test suite): `if (lesson.isFree || !lesson.requiredPreviousLessonId)
   return { allowed: true }` meant that as soon as a lesson was marked free
   (a routine marketing setting — "free lessons to attract students"), its
   `requiredPreviousLessonId` prerequisite was silently ignored. A student
   could watch a free Lesson B and take its quiz without ever completing
   Lesson A, defeating the entire sequential-curriculum feature for every
   free lesson with a prerequisite — this is the exact "existing but not
   wired" bug class the mandate specifically asked this audit to hunt for,
   and it survived the first audit wave's business-logic tests because none
   of them combined `isFree: true` with a `requiredPreviousLessonId` in the
   same lesson (`quiz.test.ts`'s existing gating tests all used
   default/non-free lessons).

## Bugs Fixed

All six CRITICAL items above, plus (HIGH) store stock-decrement and
promo-code usage-limit races, certificate double-issuance and
daily-game-replay races, unhandled FK-violation crashes on deleting a
played game or an answered question, and a blocked user's live session
surviving until natural JWT expiry; plus (MEDIUM) heartbeat
refId-fabrication and double-credit, referral-reward-on-$0-checkout,
`confirmPayment`/`applyPendingReferralReward` TOCTOU races, an unhandled
achievement-award race, a completely missing support-ticket-reply
notification, order-independent MATCHING-question grading, a quiz
attempt-limit bypass via abandoned attempts, unbounded manual-grading
points, `updateTicketStatus` having no authorization of its own, and a
missing parent-link revocation capability. Two previously fully-built but
completely unreachable features (`refundPayment`, `grantAdminEntitlement`)
were given real teacher UI. The sixth CRITICAL bug (`isFree` bypassing
sequential lesson gating, found by the E2E pass) was fixed by removing the
`lesson.isFree ||` short-circuit from `canAccessLesson` so the prerequisite
check always runs when `requiredPreviousLessonId` is set, regardless of
the lesson's own price/free status — `isFree` now correctly affects only
entitlement/payment (`checkVideoAccess`'s `FREE_VIDEO` rule), never the
curriculum-sequencing rule. Every fix has a dedicated regression test; see
commits `9377212`, `1d61cdb`, `a38dea4`, `71aa679`, and the final
E2E-driven fix commit.

## Security Findings

- Passwords: bcrypt (cost 12) everywhere, no plaintext path found anywhere
  in the codebase.
- No classic IDOR found across 25+ checked ID-taking mutations (notes,
  bookmarks, watch-sessions, exam attempts, parent links, support tickets,
  orders, game sessions) — every one correctly scopes to the caller's own
  `studentId`/`authorId`.
- Path traversal on video storage: not exploitable — storage keys are
  always server-generated `randomUUID()`s; any key containing `..`, `/`,
  or `\` is explicitly rejected.
- Signed playback tokens are HMAC-SHA256, constant-time-compared, and
  re-verified (full entitlement re-check) on *every* stream request, not
  just at issuance — refund/expiry mid-window is correctly caught. The one
  residual gap (a copied URL working for a logged-out third party for its
  4h TTL) is listed in Known Gaps.
- No real payment gateway is wired (by design, documented, no fake success
  path exists for a non-zero amount).
- Login rate limiting is real (server-side, configurable, case-insensitive
  per email) and account blocking now genuinely revokes an already-issued
  session, not just future logins.

## Authorization Findings

RBAC discipline was found to be unusually consistent for a project this
size. The one architectural fragility found (`updateTicketStatus` having
no authorization of its own, relying entirely on its single caller) has
been fixed by moving the check into the shared function. `searchForTeacher`
and teacher-side grading/analytics/reports having no per-course ownership
restriction were investigated and confirmed to be a **consistent, correct**
design choice for this single-institution deployment (all `TEACHER_ADMIN`
accounts are intentionally trusted co-administrators — the same design the
account-moderation feature already assumes), not an inconsistency.

## Business Logic Findings

See "Critical Bugs Found" and "Bugs Fixed" above. Additionally: the games
subsystem's MINI/DAILY_MAIN distinction is real but shallower than the
original "~5 min possibly-hourly / ~10 min once-daily" framing implied (no
duration cap enforcement, no hourly-recurrence mechanic) — classified
PARTIAL, not hidden behind a generic "known gap," per the mandate's
explicit instruction.

## Cross-Phase Integration Findings

- `evaluateAchievementsForStudent` is correctly wired from all four real
  trigger points (streak update, experiment completion, quiz pass, game
  score) — no new instance of the historical "tested but never called"
  dead-wiring bug class was found beyond two already-known ones
  (`refundPayment`, `grantAdminEntitlement`), both of which now have real
  UI.
- Lesson completion is now recorded *before* achievement evaluation runs
  (reordered this audit) so a lessons-completed-based achievement fires on
  the same trigger that completes the lesson, not one trigger later.
- Analytics and Reports compute nominally-the-same metrics (lessons
  completed, quizzes passed) via **divergently scoped** queries — see
  Known Gaps #4.

## Database Findings

A dedicated migration (`20260920000000_final_audit_integrity_fixes`) adds:
a real `@@unique([studentId, courseId])` on `Certificate`, a real
`@@unique([gameId, studentId, playDate])` on `GameSession` (backed by a new
`playDate` column), and missing indexes on `Product`, `CareerExplorationResult`,
`StudyActivitySession`, `ReferralReward`, `Subscription`, `Entitlement`,
`ParentStudent`, `OrderItem`, and `Announcement` — all purely additive, no
data migration risk. `deleteGame`/`deleteQuestion` no longer crash with a
raw, unhandled foreign-key violation. Remaining, deliberately undone
schema-level items (a real design tension around `Entitlement`'s
`onDelete: SetNull` behavior, several audit-relevant `*Id` columns with no
FK/relation at all, and a few numeric-type nits like `PromoCode.value`
being `Float`) are documented in Known Gaps rather than changed blindly
under time pressure, since several of them touch delete/cascade semantics
on live data model relationships.

The gap-closure round added two more migrations, both purely additive,
with nullable or defaulted columns and a unique index on columns that
are NULL for every existing row, so there is no conflict and no data
rewrite:
- `20260924000000_game_mini_cooldown`: `Game.miniCooldownMinutes`
  (default 60), `GameSession.cooldownBucket`, and
  `@@unique([gameId, studentId, cooldownBucket])`.
- `20260924000100_notification_dedupe_key`: `Notification.dedupeKey`
  and `@@unique([userId, dedupeKey])`.

Both were applied cleanly with `prisma migrate deploy` to the dev and
test databases.

## Video Security Findings

Core design is sound: private storage, signed+expiring tokens, full
entitlement re-verification on every stream request (not just at token
issuance), HTTP Range support, no raw file path ever sent to the client.
Genuinely absent (and honestly documented in SECURITY.md, not overstated):
HLS/DASH segmenting, real DRM, concurrent-session/device-limit detection,
a CDN. The identity watermark is correctly described as a deterrent, not a
cryptographic guarantee. The one lower-severity gap found in the audit,
a copied signed URL working for any bearer (including a logged-out one)
for its 4-hour TTL, was **closed in the gap round**: the stream route
now requires a live session matching the token's `studentId` on every
request, with no exception for requests without a cookie. That is proven
by unit tests and a browser E2E step (owner → 200/206, logged-out → 403,
other student → 403).

## Test Quality Findings

The pre-audit suite (220 tests) had genuinely shallow coverage in a few
places relative to the complexity of the module — most notably `quiz.ts`
had only 4 tests despite being one of the most complex and highest-stakes
modules in the app, and none of them exercised the exact exploit classes
found (question-coverage, lesson-sequence, time-limit). Every fix in this
audit added a test that would fail against the pre-fix code, and every
concurrency-class bug got a test using real `Promise.all`/`allSettled`
concurrency against the actual Postgres test database (never a mock) —
proving the fix under the same conditions that caused the original bug,
not just a sequential happy-path check. The suite stood at 238 tests
after the audit, and stands at **270** after the gap-closure round, all
passing.

A note on concurrency tests found during the gap round: a
`Promise.allSettled` burst of 8 calls did **not** reproduce the
`TARGET_REACHED` race against the pre-fix code in this environment, so
it could not serve as proof. For both race fixes in the round (TARGET_REACHED and
MINI cooldown), the regression proof is therefore a deterministic
"stale read" test: a client whose pre-check `findFirst` returns `null`,
which is exactly what the losing request of a real race observes. Both
tests fail against the pre-fix code. The MINI test also fails when only
the DB constraint is disabled, which shows the constraint, not the read
check, is what enforces the rule.

## E2E Findings

A real browser-driven Playwright suite (18 steps, transient dev dependency
— installed, run, then uninstalled per this project's established
convention of never committing test infrastructure) was run against a live
`next dev` server and a real Postgres database, exercising actual page
navigation, form submission, and DOM assertions rather than calling
business-logic functions directly. Final result: **18/18 steps passing.**

Flows verified end-to-end through real pages, in order:
1. Student self-registration lands on the student dashboard.
2. Teacher creates a category and a course through the CMS UI.
3. Teacher publishes the course and adds two lessons — Lesson A (free, no
   prerequisite) and Lesson B (free, `requiredPreviousLessonId` = Lesson A).
4. Teacher uploads a video to each lesson and publishes both.
5. Teacher builds a question bank, adds a question, and creates a
   lesson-quiz for Lesson A.
6. **Free lesson A appears on the student dashboard's "free lessons"
   section** (this exercises the real `Lesson.isFree && Video.isFree &&
   status === PUBLISHED` discovery query, not just the business-logic
   layer).
7. **Lesson B is genuinely locked** (`يجب إكمال الدرس السابق واجتياز
   اختباره أولًا` shown, no video player rendered) before Lesson A's quiz
   is passed — this step is what caught CRITICAL bug #6 above: the first
   E2E run showed Lesson B's video playing immediately despite an unmet
   prerequisite, because `canAccessLesson` was short-circuiting on
   `isFree`. Confirmed as a genuine application bug (not a script issue)
   by reading `canAccessLesson`'s source directly, fixed, and re-verified
   green on rerun.
8. Student takes and passes Lesson A's real quiz through the actual exam
   UI (question rendering, radio selection, submission, pass/fail
   feedback).
9. **Lesson B is now unlocked** and its video player actually renders,
   proving the gate opens correctly once the real prerequisite is met.
10. A second student registers and keeps a live session open; the teacher
    blocks that account; the **already-logged-in** student loses access on
    their very next request with no new login involved (proving the
    `auth.ts` session-callback live-status re-check fixed earlier in this
    audit is wired correctly end-to-end, not just at the unit level).
11. The blocked student cannot log in directly either; the teacher unblocks
    them and login works again.
12. Login rate limiting: 5 wrong passwords lock the account such that even
    a 6th, *correct* password is still rejected.
13. Global search finds the newly created course by title.
14. The achievements page loads correctly for a student who just passed a
    quiz.

Every failure encountered while building this suite (across five
iterations) was individually root-caused by reading the actual page
source before changing the script — never assumed. All but one were
confirmed to be script-authoring mistakes (ambiguous locators matching a
closed `<select>`'s hidden `<option>`, a stale locator API call, leftover
data from earlier script runs producing duplicate dashboard rows once
lesson titles were reused). Exactly one was a genuine, previously-hidden
application bug (CRITICAL bug #6, above) — precisely the outcome this kind
of independent, real-browser verification pass exists to catch, and
precisely why the mandate required it rather than accepting the
business-logic test suite alone as proof.

Not covered by this browser pass (relies on the already-rigorous
Vitest/Postgres integration suite as its primary evidence instead, per
sound testing practice — building full browser coverage for all
~27 originally-listed workflows was not achievable within this session's
practical constraints): games/leaderboard/Hall of Fame, store/orders,
promo-code redemption, certificates issuance/verification, referral
rewards, career guidance, teacher profile, support tickets, notifications/
announcements, parent linking/reports, and Shorts. None of these are
untested — all have real, passing integration tests against the actual
database — but they were not additionally driven through a real browser
in this pass.

**Gap-closure round E2E (2026-09-24): 26/26 steps passing.** The same 18
steps plus 8 new ones:
- 8a: the owner's session streams the signed URL (200/206); the same URL
  gets 403 when logged out and 403 for a different logged-in student (gap #2).
- 8b–8c: a teacher creates a MINI game (5 min, hourly); a student plays it
  once, then the replay is refused inside the same hour and the start
  button is no longer offered (gap #5).
- 8d–8e: a teacher creates a career field with roadmap and resources and
  edits it in place with the same id; the student sees the steps and a
  `rel="noopener"` link (gap #6).
- 8f: teacher contact info, social links and locations are saved and
  shown on the public profile to a logged-out visitor (gap #7).
- 8g: the batch "grant to all course subscribers" action runs and appears
  in the audit log (gap #1).
- 8h: a student is redirected away from all four new teacher-only pages.

One run hit a failure in 8a before any of its assertions executed: the
login POST was rejected by Auth.js with `MissingCSRF`. It was
root-caused rather than dismissed as a flake. Auth.js issues a fresh
CSRF cookie on *any* cookie-less auth request, so concurrent
`/api/auth/session` and `/api/auth/csrf` requests in a brand-new browser
can set two different tokens. This was reproduced directly with two
concurrent requests, which returned two different `authjs.csrf-token`
values. It occurred in 1 of 34 logins and fails closed. It is listed
under Remaining Gaps and was not fixed, because it is outside the
approved scope at the time. A full re-run then passed 26/26. It has
since been fixed; see Remaining Gaps #13.

**Follow-up round E2E (#13 fix): 26/26 + 5/5.** Five new fresh-browser
login scenarios cover:
- the injected race with a correct password: logged in after exactly one
  retry, with one successful login attempt recorded;
- no race: one POST, logged in;
- a wrong password: one POST, not retried, the wrong-credentials message,
  and exactly one failed attempt recorded;
- the injected race with a wrong password: retried once, still rejected
  as wrong credentials, with one failed attempt recorded;
- a persistent CSRF failure: exactly two POSTs, not logged in, and a
  distinct session error.

In the first full re-run, step 8c failed. This was root-caused: the
server recorded the game correctly (ended, score 1), but the runner's
score text is replaced almost at once by the play page's cooldown notice
after `router.refresh()`, and that step had asserted on the transient
text. The step now asserts on the server-recorded session. The brief
score display itself predates this round and was left unchanged.

### E2E — MUST FIX round (2026-09-25)

A new 32-step suite ran against a production build (`next start`) and
the dev database.

**MF#1 — publish status**
- An entitled student loses an unpublished lesson everywhere:
  - the dashboard, the video URL (title hidden) and search;
  - the notes, bookmarks and heartbeat APIs (403/4xx);
  - the stream route (401).
- The entitlement row itself is untouched.
- Re-publishing restores access.
- Archiving keeps the holder's access and shows a badge. Others are
  refused, search hides it, and a teacher grant is refused. An archived
  free lesson is no longer free.
- Unpublishing only the video also hides it.

**MF#2 — experiments**
- The editor rejects bad configs, including an unreachable target and
  `process.exit()`.
- All four types were created and played in the browser.
- The experiment page HTML contains no answer-key fields.
- Replaying the captured `submitAttempt` server action with `[]`, with
  empty placements, or with out-of-range values returns `ok:false`.
- Another student replaying the submit on this attempt gets
  "محاولة غير موجودة", and replaying `startAttempt` creates no attempt
  for them.
- EXERCISE heartbeats:
  - refused without a live attempt, for a fabricated id, and for another
    student;
  - the client sends none while idle and none while the tab is hidden,
    but does send them while the student is interacting.

**MF#3 — attachments**
- Spoofed `.pdf` and `.html` uploads are rejected, and the stored name is
  sanitized from `../../`.
- The downloaded bytes match the upload.
- Refused cases:
  - anonymous request (401);
  - another student using the link (403);
  - a swapped attachment id (401);
  - a forged token (401);
  - raw storage paths, which never serve the file.
- Unpublishing revokes an already-issued link. Deleting the file gives
  404.

**MF#4 — certificate QR**
- The QR was decoded from rendered pixels with `jsqr`. It decodes to
  exactly the public verify URL and contains no internal id.
- Without login, the page shows the certificate as valid.
- A one-character change gives "not found"; the internal id,
  SQL-ish input and `%` give "invalid"; lowercase is still valid.
- Another student gets 404 on the printable page.
- Revoke shows "revoked" with no reason; restore shows "valid" again.

**MF#5 — report PDF**
- Parent link approved; preview works; the Print button opens the print
  dialog.
- `page.pdf()` produced a 1-page PDF. Its text contains the student and
  contextually shaped Arabic (presentation forms, visual RTL order), and
  no NaN or navigation chrome.
- Refused: an unlinked parent (404), the parent's own child's URL
  carrying another student's report (404), a student, and anonymous
  users.
- Teachers can view the report.

**SHOULD FIX**
- Referral signup stores the enum type with an integer value of 7.
- The database refuses deleting an entitled lesson or a teacher who owns
  courses.
- All 9 constraints are RESTRICT.

**What E2E found:**
1. The mini-game result was unmounted by `revalidatePath` inside
   `playMove`/`submitAttempt`. Fixed: the client refreshes when the
   student continues.
2. A production server needs `AUTH_TRUST_HOST=true` (documented;
   superseded 2026-09-26 by a required https `AUTH_URL`).
3. Several test-side selector and assumption issues. For example, in RTL
   ArrowRight *decreases* a range input, and search pages echo the query
   text.

The original 26-step suite and the 5 CSRF login scenarios were re-run
against the same production build; see Production Readiness.

## External Infrastructure Required

- **Real payment gateway** (Stripe/PayMob/Fawry/…) — the abstraction
  (`src/lib/payments/provider.ts`) is ready; only `createIntent()` needs a
  real implementation, with its webhook calling the existing
  `confirmPayment()`/`rejectPayment()`.
- **Video pipeline** (transcoding/HLS/DASH, a DRM-capable provider such as
  Cloudflare Stream or Mux, a CDN) — `StorageProvider` is deliberately
  swappable for this.
- **Scheduled jobs / cron** — subscription-expiry sync and parent-report
  generation are currently opportunistic/manual; a real scheduler would
  automate both without any business-logic change.
- **Email/SMS delivery** — `notify()` is the single hook point where this
  would be added without touching any trigger's call site.
- **CAPTCHA/anti-abuse** for registration: an *external security
  enhancement*, not an original requirement (needs reCAPTCHA/hCaptcha/
  Turnstile).
- **Monitoring/backups** — out of scope for an application-code audit;
  standard production deployment concerns.

## Remaining Gaps

**Closed in the gap-closure round (2026-09-24)**, each with regression
tests and, where it has UI, a browser E2E step:

1. ~~Manual-only backfill of new content~~ → **CLOSED.**
   `grantLessonToCourseSubscribers` grants a lesson to every student with
   an ACTIVE, unexpired subscription whose plan includes the whole
   course. Plans made of hand-picked lessons are excluded, so it never
   over-grants. It is idempotent, and each grant expires with the
   student's subscription. It runs as one transaction with an AuditLog
   row, from a `TEACHER_ADMIN`-only action on `/teacher/entitlements`.
2. ~~Signed video URL redistribution~~ → **CLOSED.** Unconditional
   session binding on `/api/stream/[videoId]` (see Video Security Findings).
3. ~~Duplicate `TARGET_REACHED` race~~ → **CLOSED.** Enforced by a real
   `@@unique([userId, dedupeKey])` constraint. The losing caller gets
   `null` rather than an error.
4. ~~Analytics vs. Reports divergence~~ → **CLOSED.** `reports.ts` now
   scopes lesson and quiz counts through the same
   `getEnrolledPublishedLessonIds` definition that analytics uses. A test
   asserts that a report and analytics give the same numbers.
5. ~~No real Mini/Daily distinction~~ → **CLOSED.** Enforcement is
   server-side: the duration deadline on submit uses server time only,
   and a late submission earns 0 points. MINI is limited to once per
   configurable window (default 60 min) and DAILY_MAIN to once per day
   after its opening time; both limits are real DB constraints.
6. ~~CareerField not editable; roadmap/resources unused~~ → **CLOSED.**
7. ~~TeacherProfile social/contact/locations unwired~~ → **CLOSED.**

**Still open:**

8. ~~`Entitlement.lessonId`/`videoId` use `onDelete: SetNull`~~ →
   **CLOSED (MF round).** Now `RESTRICT`. This does not conflict with
   unpublish/archive, which only change `status`, and no code path deletes
   content. A delete of entitled content, directly or via the course
   cascade, now fails instead of silently orphaning grants. Covered by
   regression tests and an E2E database check.
9. ~~Audit-relevant `*Id` columns without FKs~~ → **CLOSED (MF round)
   for the seven real User relations:** `User.blockedById`,
   `Course.teacherId`, `QuestionBank.teacherId`, `QuizAnswer.reviewedById`,
   `Entitlement.grantedById`, `Payment.confirmedById`,
   `HallOfFameEntry.approvedById`, all `ON DELETE RESTRICT`.
   - The orphan check on existing data found 0 orphans in every column.
   - The migration's preflight aborts before any DDL if orphans exist,
     listing each column and its count. This was verified against a
     deliberately orphaned row.
   - No FKs were added on unused models such as `TeacherNote`.
10. ~~Numeric type nits~~ → **CLOSED (MF round) for the referral columns:**
    `ReferralReward.rewardType` is now the `ReferralRewardType` enum and
    `rewardValue` is `INTEGER`.
    - The data showed a single type, always a whole number of days.
    - Both columns are converted in place with `USING` casts, and existing
      rows are preserved.
    - The preflight aborts on unknown types or non-integer values.
    - A fractional reward-days setting is now rejected instead of being
      truncated.
    - **`PromoCode.value` is unchanged by design**: its meaning depends on
      the promo `type`, which is a product decision.
11. **No CAPTCHA on registration.** Reclassified as an *external security
    enhancement*: it isn't an original requirement and needs an external
    provider.
12. **HLS/DASH/DRM/CDN, real payment gateway, scheduled jobs.** External
    infrastructure. The existing abstractions are unchanged, and nothing
    fakes any of them. (PDF is **not** external infrastructure: reports
    and certificates are printable pages whose browser "Save as PDF" is
    the PDF. See #27 and #38.)
13. ~~Auth.js `MissingCSRF` on a first login in a fresh browser~~ →
    **CLOSED (2026-09-24, follow-up round).**
    - **Root cause:** Auth.js mints a new CSRF cookie on any auth request
      that arrives without one. In a fresh browser, concurrent cookie-less
      requests (the SessionProvider's `/api/auth/session` and `signIn`'s
      own `/api/auth/providers` and `/api/auth/csrf`) can each set a
      different token. If the cookie jar ends up out of step with the
      token `signIn` posted, the server rejects the POST in
      `validateCSRF`, before `authorize()` runs.
    - **Fix:** `src/lib/sign-in-with-csrf-retry.ts`, used by
      `login-form.tsx`, retries `signIn` exactly once, and only when the
      result's `error` is exactly `MissingCSRF`. Each `signIn` call
      re-fetches `/api/auth/csrf`, and by then the jar holds one valid
      cookie, so the retry posts the matching token.
    - **Other errors:** a wrong password (`CredentialsSignin`) and any
      other error are never retried. They show the same message as
      before, so credential failures are not hidden and rate limiting
      still records exactly one attempt. A CSRF failure that persists is
      reported after one retry, with no loop, as a distinct "session could
      not be verified" message instead of the misleading "wrong password".
    - **No auth bypass:** the retry is just a second full sign-in, with
      the same credential check, CSRF check and rate limit.
    - **Proof:** 7 unit tests, plus 5 fresh-browser Playwright scenarios.
      The scenarios reproduce the race's end state with a real,
      server-minted foreign CSRF cookie. Against the pre-fix form, 3 of 5
      fail (the correct password is rejected with a single `MissingCSRF`
      POST); with the fix, 5 of 5 pass.
    - **Not changed:** `register/page.tsx`'s automatic sign-in after
      signup can hit the same race, but it already falls back to `/login`,
      where this fix applies. It was kept unchanged to stay within the
      approved scope.

## Production Readiness Assessment

**Release-candidate gate verdict (2026-09-26): READY AFTER OWNER
INFRASTRUCTURE SETUP.**
- All application-side defects found in the gate (RC1–RC8) are fixed and
  regression-tested, and no application-side blocker remains.
- Deployment was reproduced from a fresh clone.
- What remains is outside the repository:
  - a domain + TLS certificate + reverse proxy (config tested);
  - a production PostgreSQL with scheduled off-host backups and one
    performed test restore;
  - a persistent `STORAGE_ROOT` volume;
  - two recorded owner decisions (manual/offline payments; the
    password-reset procedure without email).

See DEPLOYMENT.md §13.

**Update 2026-09-26 (go-live blocker closure):**
- tsc and eslint clean; build succeeds.
- Vitest 496/496 (46 files).
- E2E on the final build: 32/32, 12/12, 10/10, 26/26, 5/5, password
  14/14, smoke 19/19, TLS 8/8.
- Coverage matrix (62 rows): **54 VERIFIED, 1 PARTIAL (#28), 1 BLOCKED
  (#61, owner infrastructure), 6 EXTERNAL DEPENDENCY** (#14, #49, #51,
  #52, #53, #62), 0 NOT IMPLEMENTED.

**Verdict:** every code-side go-live blocker is closed and verified:
password recovery, session invalidation, fail-closed configuration, TLS
behaviour behind a proxy, storage safety, and payment integrity. **The
platform is not yet production-ready**, because these remain and only
the owner can close them (DEPLOYMENT.md §13):
1. A domain, TLS certificate and reverse proxy (the config is tested).
2. A production PostgreSQL with scheduled, off-host backups and **one
   performed test restore**.
3. A persistent `STORAGE_ROOT` volume included in the backups.
4. Recorded decisions: launch with manual/offline payments; the
   password-reset procedure without email (teacher-issued links +
   operator script) or add an email provider.

HLS/DRM/CDN, email/SMS, scheduled jobs, CAPTCHA and external monitoring
are **not configured and not claimed to work**. None of them is required
for a small single-instance launch; monitoring is recommended.

**Update 2026-09-25 (production readiness & deployment audit):**
- tsc and eslint are clean, and the production build succeeds.
- Vitest: **446/446** (39 files).
- Playwright, against `next start`:

  | Suite | Result |
  |---|---|
  | MUST FIX | 32/32 |
  | Full role journey | 12/12 |
  | HTTP security/concurrency stress | 10/10 |
  | Original | 26/26 |
  | CSRF | 5/5 |

- Mobile/accessibility audit: 21 pages, 0 px overflow, no serious or
  critical axe violations.

**Verdict:** the application code is deployable for a single-instance,
small-scale launch that uses the explicitly labelled manual/offline
payment workflow. It is **not** launch-ready until the owner closes these
items (see DEPLOYMENT.md §12):
- password recovery (#50);
- the manual-payment decision (#49);
- TLS plus a reverse proxy with rate/size limits;
- a production Postgres with scheduled, restore-tested backups;
- a persistent private `STORAGE_ROOT` volume.

HLS/DRM/CDN, email/SMS, scheduled jobs, CAPTCHA and external monitoring
are not configured and are not claimed to work.

**Update 2026-09-25 (MUST FIX / SHOULD FIX round):**
- tsc and eslint are clean, and the build succeeds.
- Vitest: **417/417**.
- Playwright: MUST FIX suite **32/32**, original suite **26/26**, CSRF
  suite **5/5**, all against `next start`.
- Gaps #8, #9 and #10 are closed (see Remaining Gaps).
- Still open:
  - #11 (CAPTCHA, an external enhancement);
  - #12 (external media, payment and cron infrastructure);
  - `PromoCode.value`, a product decision.

**What was true at the end of the gap-closure round:**
- `npx tsc --noEmit`: clean.
- `npx eslint .`: clean.
- `npm run build`: succeeds, all routes compile including the two newly
  added ones (`/teacher/entitlements`, and the refund UI on
  `/teacher/payments`).
- `npx vitest run`: 277/277 passing against the real Postgres test
  database (no mocks). The count was 220 before the audit, 238 after it,
  and 270 after the gap-closure round.
- A real Playwright browser E2E pass: 26/26 main-suite steps plus 5/5
  fresh-browser login/CSRF steps, against a live `next dev` server and
  real database (see "E2E Findings" above).
- Gap-closure round: gaps #1–#7 closed. #8–#10 were assessed and
  intentionally left unchanged pending product/data decisions. #11 is an
  external security enhancement and #12 is external infrastructure. The
  third-party login race found by E2E (#13) was fixed in a follow-up round.
- Six CRITICAL, several HIGH, and several MEDIUM real bugs — all
  independently confirmed via direct code reading, not assumed from a
  report — were found and fixed, each with a regression test that fails
  against the pre-fix code. One of the six (the `canAccessLesson`
  `isFree` sequential-gating bypass) was found only by the E2E pass,
  confirming the mandate's premise that business-logic tests alone are
  not sufficient proof of correct end-to-end wiring.
- The still-open items (#8–#12) are documented above with the reason
  each is open. None of them lets an unauthorized user reach protected
  content or money.
- No feature was deleted, replaced with a placeholder, or silently
  descoped during this audit.
