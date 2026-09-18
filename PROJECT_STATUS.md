# Project Status — EduPlat (Recorded-Only Educational Platform)

Last updated: 2026-09-18 (Phase 9 session)

## Current phase

Phase 9 (Parent System) is complete, on top of Phase 8 (Student
Analytics), Phase 7 (Interactive Experiments), Phase 6 (Question Bank &
Exams), Phase 5 (Student Learning Features), Phase 4 (Shorts & Timestamp
System), Phase 3 (Video Storage & Secure Playback), Phase 2 (Subscription
& Payment System), and the Phase-1 foundation (Foundation → Auth/Roles →
Database → Teacher CMS → Courses/Lessons/Videos → Video access/security →
Subscriptions/Entitlements → Student dashboard → Progress/Timer →
Quizzes/Unlocking).

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
- Video upload per lesson (in `/teacher/courses/[courseId]`): uploads a
  real file to private storage, creates/replaces the lesson's `Video` row,
  publishes it immediately (duration is teacher-entered — see Phase 3
  below for why).
- **Not yet built**: experiments editor, announcements, settings UI. The
  underlying schema for these already exists — only the teacher-facing
  forms are pending. (Shorts UI, chapters/notes editor, and the
  quiz/question-bank editor are now built — see the Phase 4/5/6 sections
  below.)

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

- **Signed, expiring video playback** (`src/lib/business/playback.ts`,
  5 tests): HMAC-signed tokens verified with constant-time comparison,
  rejecting tampered payloads and expired tokens; `issueSignedPlaybackUrl()`
  re-runs the full entitlement check before minting a token, denying a
  non-entitled student the same way `checkVideoAccess` would.
- **Streaming route authorization** (`src/app/api/stream/[videoId]/route.ts`,
  5 tests against a real file on disk): streams a full file and a byte
  range (206 Partial Content, correct `Content-Range`) with a valid token;
  rejects a missing token, a token issued for a different video, and —
  critically — re-checks entitlement at stream time and denies a video the
  student isn't entitled to even with a well-formed, unexpired token.

**51/51 tests passing** (`npm test`). Full list: `src/lib/**/__tests__/*.test.ts`
and `src/app/api/stream/__tests__/*.test.ts`.

### Student dashboard
- Daily/weekly/monthly study-time summary, current streak, weekly target
  progress bar, per-course lesson list with lock/progress state.
- Video watch page: runs the real `checkVideoAccess` gate server-side,
  shows the correct denial reason (not entitled / view limit reached), and
  for allowed videos renders a real `<video>` element streaming from a
  signed, authorization-checked URL (see "Video storage & playback" below)
  with real heartbeat/progress reporting, resume-from-last-position, and an
  identity watermark overlay.

### Parent dashboard
- Lists approved linked children (via `ParentStudent`) with aggregate
  study time and streak. No access to paid course content, per spec. See
  Phase 9 below for self-service linking and per-child analytics.

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

### Video storage & secure playback (Phase 3 — new this session)
- **Private storage**: `src/lib/storage/provider.ts`, disk-backed
  (`storage/videos/`, never inside `public/`), behind a `StorageProvider`
  interface a real cloud provider can implement later.
- **Upload**: teacher can upload a real video file per lesson
  (`/teacher/courses/[courseId]`), replacing/creating its `Video` row.
- **Signed, expiring playback**: `src/lib/business/playback.ts`
  (HMAC-signed tokens) + `/api/playback-url` (issues one after re-checking
  `checkVideoAccess`) + `/api/stream/[videoId]` (the only route that reads
  a file; re-checks entitlement again at stream time; serves real HTTP
  Range/206 responses for seeking).
- **Real player**: `src/app/student/videos/[videoId]/video-player.tsx` — an
  actual `<video>` element, resume-from-last-position, real heartbeat/
  progress reporting tied to `play`/`pause`/`timeupdate`, and a jittering
  student-identity watermark overlay.
- **Not implemented**: HLS/DASH segmenting and real DRM — both require a
  media pipeline (`ffmpeg` or a provider that does it for you) not
  available in this environment; see ARCHITECTURE.md/SECURITY.md for the
  documented seam where either plugs in.

### Shorts & timestamp system (Phase 4 — new this session)
- **Teacher** (`/teacher/shorts`): upload a short video (reuses the same
  private storage as lesson videos), enforcing the configurable
  `SHORT_MAX_DURATION_SECONDS` platform setting; optionally link it to a
  source lesson video + an exact timestamp; publish/archive toggle.
- **Public student-facing feed** (`/shorts`, `/shorts/[shortId]`) —
  reachable **without login**, matching "students can watch free Shorts
  without subscribing": lists published Shorts, plays one via the public
  `/api/stream-short/[shortId]` route (no token/entitlement needed — Shorts
  are free by design), and on the video's `ended` event shows the CTA from
  `resolveShortCallToAction()`: opens the original lesson video at the
  linked timestamp if the (logged-in) viewer is entitled to it, otherwise a
  subscribe/login CTA. A guest never even gets an entitlement check — they
  always see the CTA.
- **Video chapters editor**: `VideoChapter` (schema existed since Phase 1,
  already displayed on the student watch page) now has a teacher-facing
  add/delete UI inside each lesson's video block.
- Manually verified end-to-end in a real browser: teacher uploads a
  standalone Short → it appears on the public `/shorts` feed → a
  brand-new, logged-out browser context opens it and the rendered
  `<video>` element's `src` is a live `/api/stream-short/<id>` URL that
  plays the uploaded bytes with no authentication at all.

### Student learning features (Phase 5 — new this session)
- **Notes & bookmarks**: students can save a timestamped private note or
  bookmark at any point in a video (`/api/notes`, `/api/bookmarks`, each
  with an ownership-checked delete route), directly from the video player
  — click any saved item to seek back to it. `/student/saved-moments`
  lists every note/bookmark across all videos.
- **Continue watching**: the student dashboard surfaces the most recently
  watched video whose lesson isn't yet completed, with a one-click resume.
- **Learning history** (`/student/history`): completed lessons and graded
  quiz attempts, most recent first.
- **Free-lesson discovery** (bug found and fixed this session): free
  lessons were previously only listed on the dashboard if the student
  already had a paid entitlement in that course — a student with no
  subscription at all had no way to find free content even though
  `checkVideoAccess` already allowed it. The dashboard now has a
  dedicated "دروس مجانية متاحة للجميع" section for exactly this case.
- **Targets**: `/teacher/targets` lets the teacher set platform-wide
  default daily/weekly/monthly study-time targets (student-specific
  targets, when they exist, still take priority). The student dashboard
  now shows progress bars for all three periods, not just weekly.
- **Notifications**: `src/lib/business/notifications.ts`'s `notify()` is
  the one function every notification goes through. Wired into: a lesson
  unlocking after a passed quiz (`LESSON_UNLOCKED`), a subscription
  becoming active whether via free/promo checkout or manual payment
  confirmation (`SUBSCRIPTION_ACTIVATED`), and reaching the daily study
  target for the first time that day (`TARGET_REACHED`, de-duplicated per
  day via a JSON-field check on existing notifications). A bell icon in
  the student header (`src/components/notification-bell.tsx`) polls
  `/api/notifications` every 30s and supports mark-all-read.
- Manually verified end-to-end in a real browser: uploaded a free lesson
  video, confirmed it appears in the new "free lessons" dashboard section
  for a student with zero subscriptions, added a bookmark and a note from
  the player, and confirmed both show up on `/student/saved-moments`.

### Question bank & exams (Phase 6 — new this session)
- **Question bank editor** (`/teacher/question-bank`): create named banks,
  add questions of any `QuestionType` (`SINGLE_CHOICE`, `TRUE_FALSE`,
  `MULTIPLE_CHOICE`, `MATCHING`, `SHORT_ANSWER`, `ESSAY`) with type-aware
  input parsing (comma-separated options/correct-answers for choice/matching
  types; `SHORT_ANSWER`/`ESSAY` store no correct answer — they always route
  to manual grading), delete a question.
- **Exam builder** (`/teacher/exams`): create a `Quiz` with any
  `examType` (`WEEKLY`/`MONTHLY`/`MIDTERM`/`FINAL`/`CUSTOM`, on top of the
  existing `LESSON_QUIZ`), set passing score, max attempts, an optional
  time limit, an optional `availableFrom`/`availableTo` window, and an
  optional `questionCount` for randomized subsetting; attach/detach
  questions from any bank with per-question points
  (`/teacher/exams/[quizId]`).
- **Randomized, fixed-at-start question selection**
  (`src/lib/business/quiz.ts`): when `Quiz.questionCount` is set and lower
  than the number of attached questions, `startQuizAttempt()` picks a
  random subset once and stores it on `QuizAttempt.selectedQuestionIds`
  (Fisher-Yates shuffle) — every subsequent read/submit/grade for that
  attempt is scoped to exactly that subset, so a student's assigned
  questions never change mid-attempt and grading is never diluted by
  questions they were never shown. `availableFrom`/`availableTo` are
  enforced server-side at attempt start.
- **Student exam-taking** (`/student/exams`, `/student/exams/[quizId]`):
  lists exams with open/upcoming/closed status, best graded result per
  exam, a real countdown timer derived from `startedAt + timeLimitMinutes`
  with auto-submit on expiry, per-question-type input rendering (radio,
  checkboxes, positional text inputs for matching, free-text for
  short-answer/essay), submits to `/api/exams/[attemptId]/submit` with
  server-side ownership verification.
- **Manual grading queue** (`/teacher/grading`): every ungraded
  `QuizAnswer` (essay/short-answer) across all exams in one place; award
  points + optional feedback; the attempt only finalizes to `GRADED` once
  every one of its answers has been graded.
- **Exam analytics** (`/teacher/exams/[quizId]`): attempt count, average
  percentage, and pass rate across graded attempts, plus a per-student
  attempts table.
- **Critical scoring bug found and fixed before commit**: the finalize
  step originally computed an attempt's total possible points from *every*
  question configured on the quiz, not just the subset actually assigned
  to that attempt — once random subsetting existed, this would have scored
  a student who answered 100% of their own assigned questions correctly as
  a low percentage (e.g. 4/10 instead of 4/4). Fixed and covered by a
  dedicated test that asserts the percentage is computed only over the
  assigned subset.
- Manually verified end-to-end in a real browser: teacher creates a
  question bank with a single-choice and an essay question → creates a
  custom exam and attaches both → a new student registers, opens the exam,
  answers both questions, and submits → teacher grades the essay via the
  grading queue → the exam's analytics immediately show the attempt as
  graded with a final percentage.

### Interactive experiments (Phase 7 — new this session)
- **Teacher editor** (inside `/teacher/courses/[courseId]`, per lesson):
  create an experiment of any `ExperimentType` (`SIMULATION`,
  `DRAG_AND_DROP`, `MINI_GAME`, `INTERACTIVE`), set its title, order
  (implicitly by creation order), and whether it's required or optional
  for progressing past the lesson; delete an experiment.
- **Generic interactive runner** (`/student/experiments/[experimentId]`):
  since no simulation/game engine or content-authoring pipeline is
  available in this environment, every experiment type shares one honest,
  functional runner rather than a fake per-type renderer: free-text
  instructions, an optional ordered checklist of steps the student must
  all check off, and an optional external link (`embedUrl`) opened in a
  new tab for a real third-party simulation/tool the teacher points to.
  Completing it creates a real, timestamped `ExperimentAttempt` row
  (`completedAt`, `resultJson` recording which steps were checked) — this
  is a genuine completion record, not a cosmetic checkbox.
- **Real gating, enforced server-side, not just in the UI**: a lesson's
  quiz (`Quiz.examType === "LESSON_QUIZ"`) cannot be started
  (`startQuizAttempt` in `src/lib/business/quiz.ts`) until every
  `isRequired` experiment for that lesson has at least one completed
  attempt by that student (`allRequiredExperimentsCompleted` in the new
  `src/lib/business/experiment.ts`) — optional experiments never block.
  The student video page mirrors this same check to show/hide the "go to
  quiz" link, but the enforcement that actually matters lives in the
  business-logic layer, so it can't be bypassed by calling the API
  directly.
- **Full learning-flow wiring on the video page**
  (`/student/videos/[videoId]`): below the video, a "التجارب التفاعلية"
  section (link per experiment, or a ✓ once completed), a "اختبار الدرس"
  section (link to the lesson's quiz once unlocked, otherwise an
  explanatory message), and a "الدرس التالي" section listing lessons
  whose `requiredPreviousLessonId` points at this one, linking straight to
  each one's video. This completes the spec's Video → Experiment → Quiz →
  Next lesson flow end-to-end.
- **Lesson-quiz creation UI** (new, in `/teacher/exams`): `Quiz.lessonId`
  and the `LESSON_QUIZ` exam type already existed in the schema and in
  `quiz.ts`'s grading/unlocking logic since Foundation, but had no
  teacher-facing way to create one — a lesson quiz always ends up
  attached to a real lesson, distinct from the free-standing
  weekly/monthly/midterm/final/custom exams built in Phase 6, which keep
  their own creation form and listing.
- **Real bug found and fixed via manual testing, not test-suite-caught**:
  `canAccessLesson()` (sequential lesson unlocking via
  `requiredPreviousLessonId`) has existed and been unit-tested since
  Foundation, but was never actually called from any route — a student
  could always open any lesson's video directly by URL regardless of
  whether the previous lesson/quiz was completed. The video page
  (`src/app/student/videos/[videoId]/page.tsx`) now calls it before
  `checkVideoAccess` and shows an explanatory message instead of the
  video when the previous lesson isn't done.
- Manually verified end-to-end in a real browser: teacher creates a
  course/lesson, uploads a video, adds a required interactive experiment,
  creates a lesson quiz and attaches a question → a new student opens the
  free lesson and sees the quiz link disabled with an explanation → the
  student completes the experiment → the quiz link unlocks → the student
  takes and passes the quiz, confirming the full gate (experiment →
  unlock → quiz) is enforced for real, not just displayed.

### Student analytics (Phase 8 — new this session)
- **Business logic** (`src/lib/business/analytics.ts`), all computed from
  real rows (no cached/derived-only fields that could drift):
  `getStudentCourseAnalytics()` (lessons total/completed, completion %,
  quizzes taken/passed, average quiz %, quiz pass rate for one student in
  one course), `getStudentOverallAnalytics()` (the same, aggregated across
  every course a student has touched, plus total study time and completed
  experiments), and `getCourseAnalyticsForTeacher()` (enrolled-student
  count, a per-lesson completion funnel revealing drop-off points, and a
  per-student breakdown table).
- **Student page** (`/student/analytics`): total study time, lessons
  completed, quizzes passed, experiments completed, and a progress bar +
  quiz averages per course.
- **Teacher pages** (`/teacher/analytics`, `/teacher/analytics/[courseId]`):
  a course list with headline stats, drilling into per-lesson completion
  bars and a per-student table (completion % and average quiz score).
- **Real bug found and fixed before commit**: a free lesson never creates
  an `Entitlement` row (see `checkVideoAccess`'s `FREE_VIDEO` bypass —
  already known from Phase 5's dashboard fix), so a student who only ever
  watched free content, or a course reached only through free lessons,
  would have been invisible in both the student's own analytics and the
  teacher's per-course analytics despite genuine engagement. Both
  functions now also derive their course/student sets from `WatchSession`
  rows, not `Entitlement` alone. Covered by two dedicated regression
  tests (one per function).
- 8 new tests (`analytics.test.ts`); 84/84 passing overall. Verified
  end-to-end in a real browser: teacher publishes a free lesson with a
  video, a student watches it, the student's own `/student/analytics`
  shows the course, and the teacher's `/teacher/analytics/[courseId]`
  shows that same student as enrolled with real completion data — with no
  paid subscription or admin-granted entitlement involved anywhere in the
  flow.

### Parent system (Phase 9 — new this session)
- **Self-service linking** (`src/lib/business/parent-link.ts`): a parent
  requests a link by the student's account email
  (`requestParentLink()`); the student sees the pending request on
  `/student/parent-requests` and must explicitly approve or reject it
  (`approveParentLink()` / `rejectParentLink()`, both ownership-checked so
  a student can only act on their own requests). A parent's dashboard
  (`/parent`) shows pending requests separately from approved children,
  and only an approved child gets a link to their analytics.
- **Real, security-relevant bug found and fixed before commit**:
  `ParentStudent.approvedAt` existed in the schema since Foundation but
  `assertParentCanAccessStudent()` never checked it — any `ParentStudent`
  row, however it was created, granted full access. This was latent but
  harmless while linking required a teacher/admin to create the row by
  hand; it would have become a real hole the moment self-service
  requesting existed, since a parent could otherwise grant themselves
  access to any student merely by requesting it. Fixed by requiring
  `approvedAt !== null`. This changed the meaning of an existing test
  (updated to construct an explicitly-approved link) and added a new test
  for the pending-link-must-not-grant-access case.
- **Parent-facing analytics** (`/parent/students/[studentId]/analytics`):
  read-only, reuses `getStudentOverallAnalytics()` from Phase 8, gated by
  `assertParentCanAccessStudent()` — an unrelated or not-yet-approved
  parent gets a 404, not an error page that leaks the student's
  existence.
- 8 new/updated tests across `parent-link.test.ts` (new) and
  `parent-access.test.ts` (updated + one new case); 93/93 passing overall.
  Verified end-to-end in a real browser: a parent requests a link, cannot
  see any analytics link for that child yet, the student approves it from
  their own account, the parent then sees the child and their real
  progress data, and — as a direct security check — a second, unrelated
  parent hitting the exact same analytics URL by hand gets a 404.

## Not started (by priority order, all schema-ready)

Monthly parent PDF reports, email/push notification delivery, announcements
UI, mini/daily games + leaderboards + Hall of Fame, achievements engine,
career guidance content + exploration quiz, certificates + public
verification page, referral system UI, support ticket UI, store/checkout,
real payment gateway integration, audit-log UI, rate limiting,
concurrent-session detection, HLS/DRM, search.

## Known gaps / honesty notes (per "no fake completion")

1. **No real payment gateway is integrated.** The abstraction exists
   (`src/lib/payments/provider.ts`); today it only offers a manual/offline
   flow that a human must confirm — `Payment.status` never becomes
   `SUCCEEDED` for a non-zero amount without that explicit
   `confirmPayment()` call. Nothing simulates a successful charge.
2. **No HLS/DASH segmenting or DRM.** Video is served as a single file over
   HTTP Range from private storage behind a signed, re-checked-per-request
   URL — strong authorization, not encryption-at-rest or license-based DRM.
   Both need a real media pipeline/provider not available here.
3. **Video duration is teacher-entered**, not auto-detected — no
   `ffprobe`/media-probing tool is available in this environment.
4. ~~Parent↔student linking has no self-service UI yet~~ — **fixed in
   Phase 9**: a parent can now request a link by email and a student
   approves/rejects it from their own account.
5. **`syncExpiredSubscriptions()` runs opportunistically on page load**
   (student/teacher subscription pages), not on a real schedule — a cron
   job or queue worker is the eventual home for it. Access control does not
   depend on this running, only the displayed `status` field does.
6. A `deepmerge-ts` advisory in Prisma's CLI tooling is open (dev-only
   dependency, not shipped to production) — see SECURITY.md for why it was
   not force-downgraded.
7. **`MATCHING` questions use a simplified positional representation** —
   the student fills in one text answer per left-hand item in order, rather
   than a drag-and-drop pairing UI; grading compares position-by-position.
8. **`timeLimitMinutes` is enforced client-side** (auto-submit when the
   countdown reaches zero) plus a submit-time check against
   `startedAt + timeLimitMinutes`; there is no server-side background job
   that force-submits an abandoned attempt the instant time expires.
9. **No conflict detection between overlapping exam schedules** — a
   teacher can create two exams with overlapping `availableFrom`/
   `availableTo` windows with no warning.
10. **No real simulation/game engine for experiments.** `SIMULATION`,
    `DRAG_AND_DROP`, and `MINI_GAME` experiment types share the same
    generic runner as `INTERACTIVE` (instructions + checklist + optional
    external link) — there is no content-authoring pipeline or game
    engine in this environment to build type-specific interactive
    content. The gating and completion-tracking around it are real; the
    interaction surface itself is intentionally simple and honest about
    that, and the `type` field lets a real per-type renderer be added
    later without a schema change.
11. **Experiment ordering is by creation order only** — there is no
    drag-to-reorder UI; a teacher who needs a specific order must delete
    and recreate experiments in the desired sequence.
12. **"Enrolled" in analytics means "has an Entitlement or WatchSession for
    this course"**, not "has an active paid subscription" — this is
    intentional (see the Phase 8 free-lesson bug fix above), but it does
    mean a student who watched one free lesson and never returns still
    counts as "enrolled" indefinitely; there is no notion of unenrolling.
13. **No teacher-facing trend charts over time** — analytics are current
    snapshots (as of the page load), not a history of how a student's or
    course's numbers changed week over week.
14. **A parent-student link request has no expiry or notification** — a
    pending request sits on the student's `/student/parent-requests` page
    indefinitely until they act on it; there is no reminder, email, or
    in-app `Notification` triggered when a request arrives.
15. **A parent can request a link to any student whose email they know** —
    by design (this is how self-service linking has to start), but there
    is no rate limiting on request attempts, so a malicious actor could in
    theory spam requests at a student (each one still requires that
    student's explicit approval to grant anything).

## Test status

```
npx vitest run       # 93/93 passing (15 files)
npx tsc --noEmit     # clean
npx eslint .         # clean
npm run build        # succeeds
```

Manually verified end-to-end in a real browser against the dev database
(Phase 3): teacher login → create a lesson → upload a real video file to
it → publish → create a subscription plan → attach the course → create a
`FREE_100` promo code → register a new student → subscribe with the promo
code (subscription `ACTIVE` immediately) → student dashboard lists the
lesson with a watch link → clicking it renders a real `<video>` element
whose `src` is a signed `/api/stream/<videoId>?token=...` URL.

Manually verified end-to-end (Phase 4): teacher uploads a Short with no
login-gated setup → it appears on the public `/shorts` feed → a
logged-out browser context plays it via `/api/stream-short/<id>` with no
authentication required.

Manually verified end-to-end (Phase 5): teacher sets default study
targets on `/teacher/targets` (confirmed via server-rendered HTML: all
three period forms present and correctly bound) → uploads a free lesson
video → a brand-new student with zero subscriptions sees it under "دروس
مجانية متاحة للجميع" on their dashboard (the bug this session found and
fixed) → opens it, adds a bookmark and a note from the player → both
appear on `/student/saved-moments`.

## Next recommended step

Phase 10 — Reports: build on `ParentReport` (schema exists, unused) and
`src/lib/business/analytics.ts` (Phase 8) to generate periodic (e.g.
monthly) progress reports for parents and teachers — this is the natural
next layer on top of Phase 9's now-working parent linking, since a report
needs the same real progress data the live analytics pages already
compute, just persisted as a point-in-time snapshot. Inspect the exact
current schema/state at the start of the phase before building. Do not
restart or re-architect what exists above — extend it.
