# Project Status — EduPlat (Recorded-Only Educational Platform)

Last updated: 2026-09-26 (release-candidate gate)

## Current phase

A full independent audit and hardening pass has been completed on top of
all 21 originally-enumerated phases, followed by an approved gap-closure
round that closed seven of its twelve remaining gaps, and a MUST FIX /
SHOULD FIX round (content status, interactive experiments, lesson
attachments, certificate QR, report PDF, real FKs). See "Final full-system
audit", "Gap-closure round" and "MUST FIX / SHOULD FIX round" below, and
`FINAL_AUDIT_REPORT.md`, for the complete Requirement Coverage Matrix,
findings, and what remains open. Phase 21 (Advanced Security) itself
completed the originally-enumerated 21-phase plan. It builds on Phase 20 (Search),
Phase 19 (Notifications &
Announcements), Phase 18 (Store), Phase 17 (Teacher Profile &
Support), Phase 16 (Certificates & Referral), Phase 15 (Career
Guidance), Phase 14 (Achievements), Phase 13 (Leaderboards & Hall of
Fame), Phase 12 (Games), Phase 11 (Promo & Marketing),
Phase 10 (Reports), Phase 9 (Parent System), Phase 8 (Student Analytics),
Phase 7 (Interactive Experiments), Phase 6 (Question Bank & Exams), Phase
5 (Student Learning Features), Phase 4 (Shorts & Timestamp System), Phase
3 (Video Storage & Secure Playback), Phase 2 (Subscription & Payment
System), and the Phase-1 foundation (Foundation → Auth/Roles → Database →
Teacher CMS → Courses/Lessons/Videos → Video access/security →
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
- *(Superseded 2026-09-25 — experiments now use a per-type registry with
  server-side grading; see "MUST FIX / SHOULD FIX round". The text below
  describes the original Phase 7 runner, which still serves legacy
  step-list experiments.)*
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

### Reports (Phase 10 — new this session)
- **Business logic** (`src/lib/business/reports.ts`):
  `generateParentReport()` builds a *permanent, period-scoped* snapshot
  (study time, lessons completed, quizzes taken/passed, average quiz %,
  experiments completed) from real activity between `periodStart` and
  `periodEnd`, and saves it as a `ParentReport` row — unlike the live
  analytics from Phase 8 (always "as of now"), a report stays accurate
  for that period even as the student keeps studying afterward.
  `getReportsForStudent()` lists a student's reports newest-period-first.
  `addTeacherCommentToReport()` lets a teacher attach a remark
  (`ParentReport.teacherComments`, existed in the schema, unused before
  this phase).
- **Teacher page** (`/teacher/reports`): pick a student and a date range,
  generate a report, and add a comment to any report missing one. There
  is no scheduled/automatic generation — a teacher (or, in a real
  deployment, a cron job calling the same business-logic function)
  triggers it, matching the same "no scheduler in this environment"
  honesty note already made for `syncExpiredSubscriptions()`.
- **Parent page** (`/parent/students/[studentId]/reports`): read-only,
  gated by `assertParentCanAccessStudent()` — an unrelated or unapproved
  parent gets a 404, exactly like the Phase 9 analytics page.
- *(Superseded 2026-09-25 — reports now have a printable preview with a
  Download/Print-to-PDF flow; see "MUST FIX / SHOULD FIX round".)*
  **No PDF generation.** `ParentReport.pdfUrl` exists in the schema but is
  never populated — there is no PDF-rendering pipeline available in this
  environment (the same category of honest gap as no `ffprobe`, no
  HLS/DRM pipeline). The report is a real, structured data snapshot
  rendered as an HTML page; a PDF export would plug into `pdfUrl` later
  without changing the underlying data model.
- 4 new tests (`reports.test.ts`); 97/97 passing overall. Verified
  end-to-end in a real browser: a teacher generates a report for a
  student and adds a comment, the linked (approved) parent sees that
  exact report and comment, and a second, unrelated parent hitting the
  same reports URL directly gets a 404.

### Promo & marketing (Phase 11 — new this session)
- **`MarketingBanner` model (new)**: distinct from `PromoCode` (a
  checkout-time discount, Phase 2) and from `Announcement` (an internal,
  logged-in-audience notice, schema-ready but still unbuilt) — this is
  genuinely public marketing copy shown to guests, with an optional CTA
  label/link (typically pointing at `/register` or a course), an optional
  active window (`startsAt`/`endsAt`), and a manual `active` toggle.
- **Business logic** (`src/lib/business/marketing.ts`):
  `getActiveBanners()` returns only banners that are `active` AND whose
  window (if any) currently contains "now" — a null bound on either side
  means unbounded on that side, mirroring how `PromoCode.expiresAt` is
  already treated.
- **Teacher page** (`/teacher/banners`): create a banner, toggle it
  active/inactive, delete it.
- **Public landing page** (`/`): renders every currently-active banner
  above the hero content, reachable by guests with no login — the same
  "genuinely public, no auth" pattern already established for Shorts in
  Phase 4.
- 6 new tests (`marketing.test.ts`) covering the active-window filtering
  (no bounds, before start, after end, inside window, inactive-overrides-
  window, ordering); 103/103 passing overall. Verified end-to-end in a
  real browser: a teacher creates an always-on banner plus one
  not-yet-started and one already-ended banner — a brand-new, logged-out
  browser context sees only the always-on one with a working `/register`
  CTA link — deactivating it removes it for guests immediately.

### Games (Phase 12 — new this session)
- **Business logic** (`src/lib/business/games.ts`): `canPlayGame()`
  gates play by real rules — `MINI` games are always replayable; a
  `DAILY_MAIN` game only opens after its configured `dailyOpenTime`
  ("HH:MM") and allows exactly one session per calendar day.
  `startGameSession()` re-checks the same gate before creating a row (so
  it can't be bypassed by calling the action directly).
  `submitGameScore()` ends the session with its final score,
  ownership-checked and rejecting a second submission for the same
  session, and credits that score to `StudentProfile.points` — the one
  place that field is written anywhere in the codebase, since nothing
  had consumed it before this phase.
- **Teacher page** (`/teacher/games`): create a game (type, name, daily
  open time for `DAILY_MAIN`, duration), add/remove multiple-choice
  questions per game (stored in `Game.config.questions`, self-contained —
  not tied to the `Question`/`QuestionBank` models, since a game is
  deliberately lighter-weight than a full exam), toggle active/inactive,
  delete.
- **Student pages** (`/student/games`, `/student/games/[gameId]/play`):
  a list showing each game's real play-eligibility (open now / not yet
  open today / already played today / inactive), and a real timed
  multiple-choice round — one question at a time under a live countdown
  (`durationMinutes`), scored by correct answers, submitted the moment
  time runs out or the last question is answered.
- **Real bug found and fixed before commit**: `startGameSession()`
  originally let Prisma's `@default(now())` set `GameSession.startedAt`
  unconditionally, ignoring the `now` parameter used to simulate a
  specific moment — harmless in production (where `now` is always real),
  but it meant the "one `DAILY_MAIN` play per day, resets the next day"
  rule was untestable and, more importantly, any future caller that did
  need a specific `startedAt` (e.g. backfilling) would have silently
  gotten the wrong one. Fixed by explicitly passing `startedAt: params.now
  ?? new Date()`. Caught by a dedicated test asserting a session started
  "yesterday" doesn't block today's play.
- **No real game engine.** Same honesty note as Phase 7's experiments: no
  canvas/game-rendering library is available in this environment, so the
  "game" is a genuine, functional timed multiple-choice round rather than
  a fabricated arcade experience — real scoring, real timing, real
  per-day gating, simple presentation.
- 10 new tests (`games.test.ts`); 113/113 passing overall. Verified
  end-to-end in a real browser: a teacher creates a MINI game with two
  questions, a student plays it and answers both correctly, the recorded
  attempt appears on the teacher's games page, and the student's points
  increase by the score earned.

### Leaderboards & Hall of Fame (Phase 13 — new this session)
- **Business logic** (`src/lib/business/leaderboard.ts`):
  `recomputeLeaderboard()` recomputes a game's ranking for the
  daily/weekly/monthly period containing "now" directly from real
  `GameSession` rows (each student's *best* score inside that period's
  date range), replacing the cached `LeaderboardSnapshot` rows for that
  exact `(gameId, period, periodKey)` in one transaction — never additive,
  so a recompute can't leave stale ranks behind. `getLeaderboard()` always
  recomputes before reading, so the displayed ranking is never more than
  one page-load stale (same "no scheduler in this environment" pattern as
  `syncExpiredSubscriptions()` and Phase 10's reports).
  `generateHallOfFameCandidates()` sums each student's `GameSession`
  scores over a whole calendar month and upserts the top N as
  `HallOfFameEntry` rows — but every one is created **unapproved**;
  `approveHallOfFameEntry()` is the only path that flips
  `approved`/`approvedAt`/`approvedById`, and `getApprovedHallOfFame()` is
  the only read path students/guests ever see, so a candidate never
  becomes publicly visible on its own (same approval-gated-visibility
  pattern as Phase 9's `ParentStudent.approvedAt`).
- **Teacher pages**: `/teacher/leaderboards` (pick a game + period via GET
  query, view the ranked table); `/teacher/hall-of-fame` (pick a month,
  generate that month's candidates, see approved vs. "بانتظار الاعتماد"
  status per row, approve one at a time).
- **Student pages**: `/student/leaderboards` (same game/period selector,
  own row marked "(أنت)"); `/student/hall-of-fame` (approved-only,
  public-facing list — an unapproved candidate is invisible here no
  matter how high their score).
- **Real schema gap found and fixed before commit**: `LeaderboardSnapshot.gameId`
  and `.studentId` were plain string columns with no `@relation` declared
  (unlike every other foreign-key-shaped field in the schema), so
  `prisma.leaderboardSnapshot.findMany({ include: { student: ... } })`
  failed to typecheck (`Type '{ student: {...} }' is not assignable to
  type 'never'`). Fixed by adding proper `@relation` fields on
  `LeaderboardSnapshot` plus the matching back-arrays
  (`Game.leaderboardSnapshots`, `StudentProfile.leaderboardEntries`), via
  a new migration (`20260919102115_leaderboard_relations`) — no data loss,
  since the table was unused before this phase.
- **No `CUSTOM` period support in the UI** — `LeaderboardPeriod.CUSTOM`
  exists in the schema and `getPeriodKey()` intentionally throws for it
  (a custom period needs an explicit `periodKey` with no date-derived
  default), but no teacher-facing "define a custom period" flow was in
  scope for this phase; only `DAILY`/`WEEKLY`/`MONTHLY` are selectable.
- 9 new tests (`leaderboard.test.ts`, covering period-key derivation,
  recompute replacing rather than accumulating rows, best-score-per-student
  ranking, and the full generate→hidden→approve→visible Hall of Fame
  flow); 122/122 passing overall. Verified end-to-end in a real browser
  (Playwright, transient dev dependency, removed after the run): a teacher
  creates a game with one question, a student registers and plays it,
  the student sees themselves (marked "(أنت)") on their own daily
  leaderboard for that game, the teacher sees the identical ranking on
  the teacher-side page, the teacher generates this month's Hall of Fame
  candidates (student appears, status "بانتظار الاعتماد"), the same
  student's public Hall of Fame page does **not** show the unapproved
  entry, the teacher approves it, and a **freshly logged-in** student
  session then sees it publicly — confirming the approval gate is
  enforced server-side, not just hidden in one UI state.

### Achievements (Phase 14 — new this session)
- **Business logic** (`src/lib/business/achievements.ts`):
  `computeStudentMetrics()` computes five real, current metrics for a
  student in one batched query set — `STREAK_DAYS` (from
  `Streak.longestStreak`, not `currentStreak`, so an achievement earned by
  once reaching a streak length is never revoked by a later reset),
  `LESSONS_COMPLETED`, `QUIZZES_PASSED`, `EXPERIMENTS_COMPLETED`, and
  `GAME_POINTS` (from `StudentProfile.points`). `evaluateAchievementsForStudent()`
  awards every non-custom `Achievement` whose `criteriaJson`
  (`{ metric, threshold }`) the student's real metrics now satisfy and
  that they don't already hold, notifying once per unlock; malformed/
  unrecognized criteria are skipped rather than ever silently unlocking.
  `awardCustomAchievement()` is the only way an `isCustom` achievement
  (no automatic condition — for recognition no metric can honestly
  capture) is ever granted, always by an explicit teacher action, blocked
  from double-awarding by the `(studentId, achievementId)` unique
  constraint. `getStudentAchievements()` returns every achievement with
  its earned status and, for non-custom ones, live progress
  (`current`/`threshold`) toward unlocking.
- **Opportunistic evaluation, no scheduler** (same pattern as
  `syncExpiredSubscriptions()`/reports/leaderboards): `evaluateAchievementsForStudent()`
  is called right after every action that can move one of the five
  metrics — a quiz pass (`quiz.ts`'s `finalizeAttemptIfFullyGraded`), an
  experiment completion (`experiment.ts`'s `completeExperimentAttempt`), a
  game score submission (`games.ts`'s `submitGameScore`), and a study-time
  heartbeat that credits time (`/api/study/heartbeat`).
- **Real, pre-existing bug found and fixed before commit**:
  `evaluateStreakForDay()` (streak computation logic, unit-tested since
  Foundation) was never called from any route — `Streak.currentStreak`/
  `longestStreak` were dead columns that never actually updated from real
  activity, silently showing "0 يوم" on the student dashboard's streak
  card regardless of genuine daily study habits, and would have made the
  new `STREAK_DAYS` achievement metric permanently unreachable. Fixed by
  wiring `evaluateStreakForDay()` into `/api/study/heartbeat/route.ts`
  (using the existing `DAILY_STREAK_MIN_ACTIVE_MINUTES` platform setting),
  right after a heartbeat credits real time for the day.
- **Teacher page** (`/teacher/achievements`): create an achievement
  (code, title, description, icon) as either automatic (pick one of the
  five metrics + a threshold) or custom (`isCustom`, no automatic
  condition); see which real students already hold each achievement;
  award a custom achievement to a specific student by name — attempting
  to award a non-custom achievement is rejected server-side, not just
  hidden in the UI.
- **Student page** (`/student/achievements`): earned achievements with
  their unlock date, and locked ones with a real progress bar
  (current metric value vs. threshold) for automatic achievements, or an
  honest "يُمنح من المعلم" note (no fake progress bar) for locked custom
  ones.
- 13 new tests (`achievements.test.ts`): metric computation (including the
  longestStreak-not-currentStreak choice), awarding on real threshold
  crossing, no double-award/double-notify, never auto-awarding a custom
  achievement however high the metrics are, malformed criteria never
  unlocking, manual-award rejection for non-custom achievements, and
  duplicate-award rejection. 135/135 tests passing overall. Verified
  end-to-end in a real browser (Playwright, transient dev dependency,
  removed after the run): a teacher creates an automatic
  `GAME_POINTS ≥ 1` achievement and a custom achievement, a student plays
  a game and immediately sees the automatic achievement unlocked on their
  own page while the custom one still shows locked with no progress bar,
  the teacher then awards the custom achievement by name, and the student
  sees it as earned too.

### Career guidance (Phase 15 — new this session)
- **Schema extension**: added `CareerField.traits String[]` (migration
  `20260919104551_career_field_traits`) — distinct from the existing
  `requiredSkills` field, which stays free-text informational content
  shown to the student, not machine-matched. `traits` holds a subset of a
  fixed, closed vocabulary (`CAREER_TRAITS` in `career-guidance.ts`:
  math/logic, creative/design, communication, hands-on, science/research,
  tech/programming, business/leadership, helping others) so the
  exploration quiz can honestly match against it — matching against a
  teacher's arbitrary free-text `requiredSkills` would be fragile and
  arbitrary, not a real match.
- **Business logic** (`src/lib/business/career-guidance.ts`): a fixed
  5-question exploration quiz (`CAREER_QUIZ_QUESTIONS`), each option
  tagged with one trait. `submitCareerExplorationQuiz()` validates every
  question is answered with a real trait, tallies how often each trait
  was picked, scores every `CareerField` by the overlap between its own
  `traits` and the student's tallies, and saves the raw answers plus the
  top 3 non-zero-overlap fields as a permanent `CareerExplorationResult`
  — a field with zero overlap is never padded in just to fill 3 slots.
  `getCareerExplorationHistory()` returns every past attempt with its
  resolved fields; `listCareerFields()` lists every field for browsing
  regardless of match.
- **Teacher page** (`/teacher/career-fields`): create a field (name,
  description, common jobs, required skills, portfolio/job-prep advice)
  and pick which traits it matches via checkboxes; a field created with
  no traits checked shows an explicit warning that it can never be
  suggested by the quiz, rather than silently never appearing.
- **Student page** (`/student/career-guidance`): take/retake the
  exploration quiz, see the latest result's suggested fields (or an
  honest "no field matched" message if none scored), a history of past
  attempts, and a full browsable list of every career field's details
  regardless of whether it was ever suggested.
- **Real, pre-existing infrastructure bug found and fixed**: the schema
  migration for `CareerField.traits` was applied to the database, but the
  already-running dev server process (started earlier in this session)
  still held the previously generated Prisma Client in memory, so the
  first live create attempt failed with `PrismaClientValidationError:
  Unknown argument 'traits'` even though `npx vitest run` (which spawns
  its own fresh process) passed cleanly. Fixed by regenerating the Prisma
  Client and restarting the dev server — a genuine "schema migrated but
  the long-running server needs a restart to see it" gap, not a code bug,
  now confirmed working end-to-end in a fresh browser session.
- 8 new tests (`career-guidance.test.ts`): correct field suggested on
  trait overlap, zero-overlap fields never suggested, at most 3 results
  ranked by score, missing-answer and unknown-question-id rejection,
  permanent result persistence, and history/listing ordering. 143/143
  tests passing overall. Verified end-to-end in a real browser
  (Playwright, transient dev dependency, removed after the run): a
  teacher creates one field tagged `TECH_PROGRAMMING` and another tagged
  only `HELPING_OTHERS`, a student answers the quiz favoring
  `TECH_PROGRAMMING` on every question offering it, and sees only the
  matching field suggested — the unmatched field never appears in the
  result box but is still visible when browsing the full field list.

### Certificates & referral (Phase 16 — new this session)
- **Certificates** (`src/lib/business/certificates.ts`):
  `issueCertificateIfEligible()` is idempotent and checks a real,
  strict condition — every one of a course's currently published lessons
  has a COMPLETED `LessonProgress` row for that student (the same
  definition `analytics.ts`'s `completionPercentage` already uses) —
  before creating a `Certificate` row with a real, randomly generated
  `certificateCode`. Hooked into `quiz.ts`'s
  `markLessonCompletedAndUnlockNext()`, so a certificate appears the
  moment the student's own course-completion bar would read 100%, never
  before and never twice for the same course.
  `/certificates/verify/[code]` is a genuinely public page (no login,
  outside the `proxy.ts` role-gated prefixes, same pattern as Shorts)
  that looks up a code and either shows the real student name + course
  title + issue date, or an honest "not found" message for an unknown
  code. `/student/certificates` lists a student's own certificates with
  a link to their own public verification page;
  `/teacher/certificates` is a read-only issued-certificates log.
- **Referral rewards** (`src/lib/business/referral.ts`):
  `createPendingReferralReward()` runs at registration when a valid
  referral code is supplied (silently ignored if unknown or
  self-referential — never blocks signup, same graceful-degradation
  stance as an invalid promo code at checkout) and records an unapplied
  `ReferralReward`. `applyPendingReferralReward()` — hooked into both
  success paths in `subscription.ts` (`startSubscriptionCheckout`'s
  zero-amount branch and `confirmPayment()`) — fires the moment the
  **referred** student's first subscription genuinely succeeds (a real
  signup-to-paying-customer conversion, not just an account creation,
  which would be trivially fakeable at scale), extending the
  **referrer's** most recent subscription's `expiresAt` by a configurable
  number of days (`REFERRAL_REWARD_DAYS` platform setting, default 7).
  `/student/referral` shows a student's own referral code and every
  reward earned as a referrer (pending vs. applied).
- **Deliberate design choice**: referral rewards extend real subscription
  time rather than crediting `StudentProfile.points` — `points` already
  has one specific, meaningful source (`games.ts`'s `submitGameScore()`)
  that Phase 14's `GAME_POINTS` achievement metric reads; crediting
  referral rewards to the same field would have let a student unlock a
  "games" achievement without ever playing a game, a fake-completion
  loophole the rest of the platform deliberately avoids.
- **Honest, documented gap**: a referrer who has never subscribed at all
  has no `Subscription` row to extend — the reward is left unapplied
  (never fabricates an entitlement/subscription out of thin air) rather
  than silently dropped, so it can still be retried on the referred
  student's next successful payment if one occurs.
- 17 new tests (`certificates.test.ts`, `referral.test.ts`): eligibility
  on full completion, non-issuance on partial/zero-lesson courses,
  idempotency, unpublished lessons ignored, code lookup (found/not
  found), reward creation for valid/unknown/self-referral codes, reward
  application extending the correct subscription, no application without
  a referrer subscription, no double-application, expiry respected.
  160/160 tests passing overall. Verified end-to-end in a real browser
  (Playwright, transient dev dependency, removed after the run): a
  teacher builds a full course→lesson→question-bank→lesson-quiz chain, a
  student passes the quiz and immediately sees a real certificate with a
  working public verification link (and a bogus code is honestly
  rejected); separately, a referrer student subscribes for free via a
  promo code, a second student registers with the referrer's code and
  also subscribes, and the referrer's account shows the reward applied.

### Teacher profile & support (Phase 17 — new this session)
- **Teacher profile** (`src/lib/business/teacher-profile.ts`): `TeacherProfile`
  existed in the schema since Foundation (and the seed script already
  created an empty row for the seeded teacher) but had no UI anywhere.
  `getTeacherProfile()` returns the profile plus the teacher's own
  **published** courses (drafts excluded); `updateTeacherProfile()`
  upserts bio/photoUrl/education/experience/philosophy.
  `/teacher/profile` is the teacher's own edit form, linking to their
  real public page. `/teachers/[teacherId]` is genuinely public (no
  login, outside `proxy.ts`'s role-gated prefixes, same pattern as
  Shorts/certificate verification) and shows the bio and published
  course list for a real teacher, or a 404 for an unknown/profile-less
  user id.
- **Support tickets** (`src/lib/business/support.ts`): `createSupportTicket()`
  (student or parent, optionally naming which of the parent's *approved*
  children it's about — enforced server-side, not just hidden in the
  dropdown); `replyToTicket()` lets either the ticket's own author or any
  teacher/admin post a reply, and auto-advances a still-`OPEN` ticket to
  `IN_PROGRESS` the moment staff replies (real state, not a status the
  teacher has to remember to set); `updateTicketStatus()` is the
  teacher-only path to `WAITING`/`RESOLVED`/`CLOSED`.
  `assertCanViewTicket()` restricts a student/parent to their own
  tickets (an unrelated user gets a 404, same pattern as Phase 9's
  `assertParentCanAccessStudent`), while any teacher/admin can view all.
  `/student/support` and `/parent/support` (create + list + thread
  view), `/teacher/support` (all tickets, filterable by status, with a
  reply + status-control thread view). A `CLOSED` ticket's reply form is
  hidden — the last officially-closed word is the teacher's status
  change, not a race with a late reply.
- 14 new tests (`teacher-profile.test.ts`, `support.test.ts`): published-
  only course listing, upsert-not-duplicate on profile save,
  ticket-view/reply ownership enforcement, the OPEN→IN_PROGRESS
  auto-transition (and that it never *overrides* a status a teacher
  already advanced further), author/status filtering. 174/174 tests
  passing overall. Verified end-to-end in a real browser (Playwright,
  transient dev dependency, removed after the run): a teacher edits
  their profile and a logged-out guest immediately sees the saved bio on
  the public page; a student opens a ticket, a teacher replies (ticket
  auto-moves to "قيد المعالجة"), the student sees the reply and new
  status, the teacher marks it resolved then closed (hiding the reply
  form), and a separately registered parent successfully opens their own
  account-level ticket.
- **Known gap**: `Course.teacherId` is a plain string field with no
  `@relation` declared to `User` (unlike almost every other foreign-key-
  shaped field in the schema) — harmless for this phase's read pattern
  (a plain `WHERE teacherId = ...` filter, no `include` needed), but the
  same category of latent gap Phase 13 found and fixed for
  `LeaderboardSnapshot` should be watched for if a future phase ever
  needs to `include` a course's teacher relation.

### Store (Phase 18 — new this session)
- **Real schema gap resolved without widening `Payment`**: `Payment.subscriptionId`
  is a required field tightly coupled to `Subscription` — there is no
  polymorphic/generic payment concept, and `Order`/`OrderItem` have no
  relation to `Payment` at all. Rather than loosening `Payment`'s schema
  this late (risking every existing subscription test's assumption that
  a payment always belongs to a subscription), `OrderStatus` itself
  (`PENDING → CONFIRMED → PREPARING → SHIPPED → DELIVERED`, or
  `CANCELLED`) is the payment+fulfillment state machine: `CONFIRMED`
  specifically means a teacher/admin manually verified real money was
  received (cash on pickup, bank transfer, ...) — the exact same
  "a human confirms real money was received" honesty rule the platform
  already uses for subscription payments, just without a separate
  `Payment` row.
- **Business logic** (`src/lib/business/store.ts`): `placeOrder()`
  validates real-time stock and computes the total from each product's
  own current price inside one transaction (never a client-supplied
  price, never oversold — stock is decremented immediately alongside
  order creation). `updateOrderStatus()` enforces a real transition
  table (no skipping straight to `DELIVERED`, no moving a
  `CANCELLED`/`DELIVERED` order anywhere) and restocks every line item
  when an order is cancelled. `cancelOwnPendingOrder()` lets a student
  cancel only their own **still-PENDING** order — once a teacher has
  confirmed payment, only the teacher can cancel it, a deliberate rule
  found and fixed during this phase's own test-writing (the first draft
  let a student cancel an already-paid order).
- **Teacher UI**: `/teacher/products` (create a product, starts `DRAFT`
  like courses/lessons until explicitly shown, restock, hide/show);
  `/teacher/orders` (every order with one-click forward transitions —
  "تأكيد استلام الدفع" is the manual payment-verification gate).
- **Student UI**: `/student/store` (a real client-side cart — add/remove
  quantities bounded by real stock, checkout calls the server action
  directly) and `/student/orders` (order history with real status, cancel
  while still pending).
- 15 new tests (`store.test.ts`): real-price-based totals, stock
  decrement/rejection-without-side-effects on insufficient stock,
  unpublished-product rejection, the transition table (valid and
  invalid transitions), cancellation restocking, and the
  cannot-cancel-after-confirmation rule. 189/189 tests passing overall.
  Verified end-to-end in a real browser (Playwright, transient dev
  dependency, removed after the run): a teacher publishes a
  limited-stock product, a student orders 2 (real stock drops from 3 to
  1), the teacher confirms payment and drives the order through
  preparing → shipped → delivered while the student's cancel option
  disappears the moment payment is confirmed, and a separate order is
  placed and cancelled by the student while still pending, correctly
  restoring its product's stock.

### Notifications & announcements (Phase 19 — new this session)
- **Real audience resolution, no fabricated groups** (`src/lib/business/announcements.ts`):
  `resolveAnnouncementStudentIds()` resolves `ALL` to every real
  `StudentProfile`, `STUDENT` to exactly the named student, and
  `COURSE`/`CATEGORY` to students genuinely enrolled — reusing the same
  Entitlement-or-WatchSession "enrolled" definition `analytics.ts` and
  Phase 8's free-lesson fix already established, so a course-targeted
  announcement reaches a free-lesson-only watcher too.
  `AnnouncementAudience.GROUP` has no backing model anywhere in the
  schema (no `Group`/`StudentGroup` table exists) — rather than
  fabricate a group concept, it is explicitly rejected with a clear
  error instead of silently resolving to zero recipients.
- **Ties directly into Phase 5's already-built notification plumbing**:
  `publishAnnouncement()` creates the permanent `Announcement` record
  and immediately fans out a real `Notification` (via the same
  `notify()` every prior phase already uses) to every resolved
  recipient — a student sees it appear in their existing 🔔 bell, not
  just on a separate, easy-to-miss announcements page.
- **Teacher page** (`/teacher/announcements`): create an announcement
  (title, body, audience type, and the matching category/course/student
  picker) and see every past announcement. **Student page**
  (`/student/announcements`) and **parent page** (`/parent/announcements`):
  each shows only the announcements that genuinely apply — a student
  sees `ALL` + any `COURSE`/`CATEGORY` they're really enrolled in + any
  `STUDENT` announcement addressed to them; a parent sees `ALL` plus any
  `STUDENT` announcement addressed to one of their own **approved**
  children only (a still-pending, unapproved link grants nothing, same
  rule as Phase 9's `assertParentCanAccessStudent`).
- 12 new tests (`announcements.test.ts`): audience resolution for all
  four supported types (including the free-lesson-watcher edge case),
  the `GROUP` rejection, real `Notification` fan-out, missing-target
  rejection, and the student/parent visibility filters (including the
  not-yet-approved-parent-link case). 201/201 tests passing overall.
  Verified end-to-end in a real browser (Playwright, transient dev
  dependency, removed after the run): a teacher publishes both an
  `ALL` announcement and a `STUDENT`-targeted one at a specific student;
  that student sees both on their page and the targeted one in a real
  🔔 notification; a second student sees only the `ALL` one; a newly
  registered, unrelated parent also sees only the `ALL` one.

### Search (Phase 20 — new this session)
- **No fabricated access, only a navigation shortcut** (`src/lib/business/search.ts`):
  `searchForStudent()` searches only what a student can already discover
  elsewhere — published courses, published lessons in published courses,
  published Shorts, in-stock published products, and career fields.
  Clicking a lesson result still lands on `/student/videos/[videoId]`,
  which runs the exact same `checkVideoAccess`/`canAccessLesson` gate as
  normal browsing — search never grants access it wouldn't otherwise
  have, and a lesson with no uploaded video is shown informationally
  (no link) rather than a broken/fabricated one. `searchForTeacher()`
  additionally surfaces drafts (a teacher is managing content, not
  discovering it) and question banks, each linking to its real
  management page.
- **Honest about missing per-item pages**: there is no student-facing
  course detail page, per-product page, or per-career-field page in the
  app today — a matched `Course`/`Product`/`CareerField` result is shown
  informationally (title + context) rather than linking to a page that
  doesn't exist; only `Lesson` (when it has a video) and `Short` results
  are clickable for students.
- **UI**: `/student/search` and `/teacher/search`, a plain GET-query
  search box (`?q=...`, no client JS required) consistent with the
  leaderboard/hall-of-fame page pattern from Phase 13.
- 9 new tests (`search.test.ts`): case-insensitive partial matching,
  draft-course exclusion for students (but inclusion for teachers),
  unpublished-course-lesson exclusion, the video-link-only-when-a-video-
  exists rule, out-of-stock product exclusion, and question-bank
  matching. 210/210 tests passing overall. Verified end-to-end in a
  real browser (Playwright, transient dev dependency, removed after the
  run): a teacher publishes a course+lesson and separately creates an
  unpublished draft course; the teacher's search finds the draft with a
  working link to manage it; a student's search finds the published
  course (informational only) and lesson, and returns zero results for
  the draft course's title.
- **Environment note, not a code bug**: the first browser-based
  verification attempt hit a one-time `MissingCSRF` error on the very
  first credentials sign-in against a freshly restarted dev server
  (student registration and every subsequent request in the same run
  worked normally) — a clean rerun with no code changes passed all 9
  steps, confirming this was a dev-server-restart race, not a defect in
  `login-form.tsx` or the NextAuth configuration.

### Advanced security (Phase 21 — new this session)
- **Real login rate limiting** (`src/lib/business/security.ts`): a new
  `LoginAttempt` model (`prisma/schema.prisma`, migration
  `20260919123819_login_attempt_and_rate_limit`) records every
  credentials sign-in attempt (success or failure) with `email`,
  `succeeded`, `createdAt`, indexed on `[email, createdAt]`.
  `isRateLimited()` counts failed attempts for an exact
  (case-insensitive) email within a rolling window and blocks further
  attempts once a threshold is reached; both the threshold (default 5)
  and the window (default 15 minutes) are configurable
  `PlatformSetting` keys (`LOGIN_RATE_LIMIT_MAX_ATTEMPTS`,
  `LOGIN_RATE_LIMIT_WINDOW_MINUTES`), not hardcoded. `src/auth.ts`'s
  `authorize()` checks the rate limit first, safely computes
  `validPassword` (guarding against a missing/already-blocked user
  before calling `bcrypt.compare`), and records every attempt via
  `recordLoginAttempt()` regardless of outcome — verified end-to-end in
  a real browser: 5 consecutive wrong-password attempts each show the
  generic Arabic error, and a 6th attempt with the **correct** password
  still fails, proving real rate limiting rather than just a
  wrong-password rejection.
- **Real account blocking** (`blockUser()`/`unblockUser()`): the first-
  ever real use of the pre-existing (Foundation-era, previously totally
  unused) `User.status`/`blockedReason`/`blockedAt`/`blockedById`
  fields, which `auth.ts`'s `authorize()` already silently enforced
  (`if (user.status === "BLOCKED") return null`) but which no UI had
  ever been able to set. `assertCanModerateUser()` rejects moderating a
  `TEACHER_ADMIN` account through this path. Both actions write a real
  `AuditLog` row (`BLOCK_USER`/`UNBLOCK_USER`) with the acting teacher
  as actor. New teacher UI at `/teacher/accounts`: lists all
  STUDENT/PARENT accounts with real status badges, a required-reason
  block form, and an unblock button — verified end-to-end: a teacher
  blocks a freshly-registered student with a reason, the student's next
  login attempt immediately fails with the generic credentials error
  (not a special "blocked" message, so blocking can't be used to probe
  which emails are registered), the teacher unblocks them, and the
  student can log in again.
- **Audit log UI** (`getAuditLog()`, `/teacher/audit-log`): lists every
  `AuditLog` entry newest-first (actor, action, entity, metadata,
  timestamp) — the log itself already existed and was already written
  to by `confirmPayment`/`rejectPayment`/`refundPayment`
  (`subscription.ts`), but had no viewer anywhere until this phase;
  `BLOCK_USER`/`UNBLOCK_USER` are new entries in the same log, so
  payment moderation and account moderation now share one real,
  append-only audit trail with no delete/edit path.
- 10 new tests (`security.test.ts`): rate-limit threshold/window/case-
  insensitivity behavior (including a rolling-window boundary test with
  an explicit fixed clock), block/unblock field + audit-log
  correctness, the `TEACHER_ADMIN`-moderation guard, and audit log
  ordering. 220/220 tests passing overall.
- **Honest scope limit — concurrent-session detection was not
  implemented.** The session strategy is stateless JWT (confirmed via
  `src/auth.ts`'s `session: { strategy: "jwt" }`); detecting or
  limiting concurrent sessions for the same account would require
  switching to database-backed sessions, a real architectural change
  to how every request authenticates — not an extension of what
  exists, so it was deliberately left out per the standing "extend,
  don't restart" rule rather than faked with a partial/misleading
  implementation.
- **Environment note, not a code bug**: the first browser-based
  verification run hit the same one-time `MissingCSRF` race documented
  in Phase 20 — on the very first credentials action callback (the
  auto-login immediately after registration) against a just-restarted
  dev server (confirmed via `grep -c "MissingCSRF"` = 1 for the whole
  log). The account itself was created successfully
  (`POST /api/auth/register 201`), which is why the very next step
  (the teacher finding and blocking that account) succeeded regardless.
  A clean rerun against the now-warmed server passed all 10 steps with
  zero errors.

### Final full-system audit, gap closure & production hardening (new session)

An independent, skeptical audit treating the original requirements — not
prior phase reports, not PROJECT_STATUS.md, not the existing test count —
as the sole source of truth. Ten parallel subsystem reviews (auth/RBAC,
video security, exam/quiz gating, games/leaderboard/achievements wiring,
store/promo/referral/certificates abuse, notifications/search
authorization, full database schema integrity, a repo-wide dead-code
sweep, parent system/reports/analytics, and career-guidance/teacher-profile/
support ownership) found and this session fixed:
- **5 CRITICAL bugs**: the three-view rule was bypassable via direct API
  calls (limit checked at session creation, never at consumption); a quiz
  score-coverage gap let a student omit hard/manual questions to inflate
  their score and dodge manual grading; the lesson-sequence prerequisite
  gate was never checked when starting/passing a quiz (only when
  rendering the video page), letting a guessed/shared `quizId` skip the
  whole chain; exam `timeLimitMinutes`/availability window had zero
  server-side enforcement; and game scores were 100% client-trusted (with
  the answer key sent to the browser in full), letting a single forged
  request top every leaderboard/Hall-of-Fame ranking and points-based
  achievement.
- **Several HIGH races**: store stock-decrement, promo-code usage-limit,
  certificate double-issuance, and daily-game-replay were all
  check-then-act patterns exploitable under real concurrency (each closed
  with an atomic conditional `UPDATE`/`updateMany` or a real `@@unique`
  constraint, proven with `Promise.all`/`allSettled` tests against the
  real Postgres test DB); `deleteGame`/`deleteQuestion` crashed with a raw
  unhandled FK-violation; a blocked user's *already-issued* session kept
  full access until natural JWT expiry (auth.ts's session callback now
  re-verifies live status on every read).
- **Several MEDIUM gaps**: the heartbeat endpoint accepted a fabricated
  `refId` with zero validation and had its own double-credit race
  (both fixed); referral rewards could be earned via a genuinely $0
  checkout, contradicting the feature's own "real paying customer" intent
  (removed); `confirmPayment`/`applyPendingReferralReward` TOCTOU races
  (fixed); an achievement-award race threw an unhandled error at the
  losing concurrent caller (fixed); support-ticket replies never
  triggered any notification at all (added); MATCHING questions were
  graded order-independently despite being positional (fixed); the quiz
  attempt limit could be bypassed by abandoning attempts (fixed, with
  auto-expiry so nobody gets stuck); manual grading had no point bounds
  (clamped); `updateTicketStatus` had no authorization of its own (moved
  into the shared function); a student had no way to ever revoke an
  approved parent link (added).
- **Two fully-built, fully-tested, but completely unreachable features**
  wired up with real UI: `refundPayment` (`/teacher/payments`) and
  `grantAdminEntitlement` (new `/teacher/entitlements`).
- Added missing indexes (Product, CareerExplorationResult,
  StudyActivitySession, ReferralReward, Subscription, Entitlement,
  ParentStudent, OrderItem, Announcement) in migration
  `20260920000000_final_audit_integrity_fixes`.
- 220 → 238 tests, every fix backed by a regression test that fails
  against the pre-fix code; every concurrency-class fix proven under real
  concurrent load against the actual Postgres test database, never mocked.
- A real Playwright browser E2E pass (18 steps: registration, teacher
  content authoring, sequential lesson gating, account blocking with live
  session invalidation, rate limiting, search, achievements) ran clean
  18/18 after fixes — and along the way caught a **sixth CRITICAL bug**
  that no business-logic test had caught: `canAccessLesson` returned
  `allowed: true` for any lesson with `isFree: true`, before ever checking
  `requiredPreviousLessonId` — so a free lesson with a prerequisite was
  wide open regardless of whether the prerequisite was met. Fixed by
  removing the `isFree` short-circuit; `isFree` now only affects
  entitlement/payment (`checkVideoAccess`), never sequential gating. See
  `FINAL_AUDIT_REPORT.md`'s "E2E Findings" section for the full run.
- **Honestly documented, not fixed this session** (precise scope, impact,
  and why, for each — see `FINAL_AUDIT_REPORT.md`): signed-video-URL
  redistribution to a session-less bearer within its 4h TTL; a narrow
  residual `TARGET_REACHED` duplicate-notification race across two
  different activity types; Analytics vs. Reports computing
  lesson-completion/quiz-count metrics with divergent query scoping;
  games having no real Mini/Daily duration or recurrence distinction
  beyond the once-per-day gate; `CareerField` having no update/edit
  action; three `TeacherProfile` schema fields
  (`socialLinks`/`contactInfo`/`locations`) with no edit or display UI;
  and a handful of database-level items (an `Entitlement` cascade-behavior
  design tension, several FK-less `*Id` audit columns, minor numeric-type
  nits) that would need a product decision or carry real blast-radius risk
  to change blindly.
- Full Requirement Coverage Matrix (46 requirements, each rated COMPLETE /
  PARTIAL / NOT IMPLEMENTED / BLOCKED BY EXTERNAL INFRASTRUCTURE with
  evidence) lives in `FINAL_AUDIT_REPORT.md` at the repo root.

### Gap-closure round (2026-09-24)

Seven of the audit's twelve remaining gaps were closed. #2, #4, #5, #6
and #7 were required; #1 and #3 were done because they were low-risk.
Each has regression tests, and the security- and race-related ones fail
against the pre-fix code.

- **Gap #2, signed video URL:** `/api/stream/[videoId]` now requires a
  live session matching the token's student on every request. The route
  is wrapped with `auth()`'s middleware form so the rule is unit-testable
  with a real signed cookie (`src/test/session.ts`).
- **Gap #4, reports vs analytics:** both now count lessons and quizzes
  over the same `getEnrolledPublishedLessonIds` set.
- **Gap #5, MINI vs DAILY_MAIN:** each game's duration is enforced on
  submit using server time, so a late submit earns 0 points and the
  countdown is display-only. MINI is limited to once per
  `miniCooldownMinutes` window (default 60) by a real DB unique
  constraint. DAILY_MAIN keeps its opening time and once-per-day rule.
- **Gap #6, career fields:** `updateCareerField` edits in place, keeping
  the id so past exploration results still resolve. Roadmap and resources
  are editable and shown to students, and resource URLs are http(s) only.
- **Gap #7, teacher profile:** contact info, social links and teaching
  locations/schedules are editable and shown on the public profile.
  Links are http(s) only; email and phone are validated.
- **Gap #1, batch grant:** a new lesson can be granted in one step to
  every active subscriber of its course. It is idempotent, expires with
  each student's subscription, and is audit-logged.
- **Gap #3, TARGET_REACHED:** now once-only via `@@unique([userId, dedupeKey])`.
- Two additive migrations: `20260924000000_game_mini_cooldown` and
  `20260924000100_notification_dedupe_key`.
- **#8/#9/#10 assessed and left unchanged:** each needs a product decision
  or production-data verification. None is a live bug. Reasons are in
  `FINAL_AUDIT_REPORT.md`.
- **#11** (CAPTCHA) is an external security enhancement and **#12** is
  external infrastructure; neither is faked.
- **New finding from E2E:** a rare Auth.js `MissingCSRF` race on the
  first login in a fresh browser (1 in 34 logins). It was fixed in a
  follow-up round; see below.
- Tests went from 238 to 270, all passing, and browser E2E is 26/26.

### Follow-up: gap #13 fixed (first-login `MissingCSRF` race)

- `src/lib/sign-in-with-csrf-retry.ts`, used by `login-form.tsx`, retries
  `signIn` exactly once, and only when the result is `MissingCSRF`. The
  retry re-fetches the CSRF token.
- A wrong password (`CredentialsSignin`) and all other errors are never
  retried and show the same message as before. A CSRF failure that
  persists shows a distinct "session could not be verified" message after
  one retry.
- Verified with 7 unit tests and 5 fresh-browser Playwright scenarios.
  The scenarios use a real, server-minted foreign CSRF cookie; 3 of them
  failed against the pre-fix form and all 5 pass now. Rate-limit
  accounting was checked in the database: exactly one attempt per submit.
- `register/page.tsx`'s automatic sign-in after signup was left unchanged,
  per scope. On the same race it already falls back to `/login`, where the
  fix applies.
- Tests: 277/277. E2E: 26/26 main suite plus 5/5 login/CSRF.

### MUST FIX / SHOULD FIX round (2026-09-25)

**MF#1 — Publish / Unpublish / Archive** (course, lesson, video)
- The teacher `StatusControls` on the course page set any of the three
  states per item. The effective state is computed over video → lesson →
  course (`content-visibility.ts`).
- **Unpublished (`DRAFT`)** is hidden from everyone. This includes
  existing entitlement holders, whose entitlements are left untouched.
  It is hidden from dashboards, search, video, quiz, experiment and
  attachment pages, and from the stream, notes, bookmarks and heartbeat
  APIs. The unavailable page doesn't reveal the title.
- **Archived** content stays usable by existing holders only. It is never
  listed or searchable, never free, and never granted again.
- Subscriptions and promo grants snapshot only published lessons. Before,
  they also snapshotted drafts, which then leaked to old buyers when
  published.

**MF#2 — Interactive experiments** (`src/lib/experiments/`)
- A type registry: each type has a config schema, a teacher editor
  (`experiment-editor.tsx`), a student renderer (`renderers/*`) and
  server-side grading. The four types are drag & drop, ordering, a timed
  mini game (lives, streaks, server-side moves and clock) and a
  formula-explorer simulation (sliders, safe evaluator, SVG plot, target
  band).
- The answer key never reaches the browser.
- `start` / `submit` / `move` each check role, entitlement, publication,
  prerequisite and ownership. `[]` and partial submissions are rejected.
- EXERCISE study time is sent only while the tab is visible and the
  student is interacting, and credited only during a live attempt.

**MF#3 — Lesson attachments**
- Teacher upload and delete (PDF, PNG, JPG, DOCX, PPTX; magic bytes must
  match the extension; 25 MB limit), stored privately.
- Students get 10-minute signed links bound to them and the attachment.
  The route re-checks lesson access on every request.

**MF#4 — Certificate QR**
- A real QR code from the local `qrcode` library, encoding only the
  public verify URL.
- Printable certificate page for the owner.
- The public page shows valid / revoked / not found, and malformed codes
  are rejected before any lookup.
- Teacher revoke and restore are audit-logged, and the reason is never
  shown publicly.

**MF#5 — Report PDF**
- Printable report preview for linked parents and teachers, with a
  Download / Print-to-PDF button. The browser print engine produces
  correctly shaped Arabic RTL, and no external service is used.
- One authorization gate, `getReportForViewer`, is covered by tests.

**SHOULD FIX**
- Real FKs, all `ON DELETE RESTRICT`, for the 7 User relations.
- Entitlement `lessonId` / `videoId` use RESTRICT.
- `ReferralReward.rewardType` is an enum and `rewardValue` an Int.
- Every migration carries an abort-before-DDL preflight. `PromoCode.value`
  is unchanged.

**Found and fixed along the way**
- Paid lesson quizzes could be started without an entitlement.
- Notes and bookmarks accepted any `videoId`.
- The formula parser accepted `constructor()` via the prototype chain.
- The mini game's result screen was unmounted by a server revalidation
  (caught by E2E).

**Deployment note:** `next start` needs `AUTH_TRUST_HOST=true` (or
`AUTH_URL`). It is documented in `.env.example` and SECURITY.md.
*Superseded 2026-09-26: production now requires an https `AUTH_URL` and
`STORAGE_ROOT` (DEPLOYMENT.md §2).*

### Production readiness & deployment audit (2026-09-25)

This round verified the platform the way a production launch would:
- a fresh deployment on an empty database;
- an upgrade of a populated database, with backup/restore and a tested
  failure recovery;
- full role journeys, including the manual/offline payment flow, which
  is never presented as a gateway;
- HTTP-level attack and concurrency runs;
- a mobile and accessibility audit, plus latency measurements.

**Real defects fixed**, each with a regression test (details in
FINAL_AUDIT_REPORT.md → Production Readiness):
- The paid-video view limit was still client-trusted. Views are now
  counted from the bytes the server delivers per playback session, under
  an advisory lock, and the final paid view can be finished.
- The seed's default admin password in production.
- No startup validation or `STORAGE_ROOT`; world-readable private files.
- Dead-on-arrival and duplicate subscription checkouts.
- Students were not told that payment is manual.
- The teacher analytics overview ran about 3 queries per student per
  course (6,120 queries → 140).
- Missing security headers and Arabic error/404 pages.
- Broken mobile layouts (student pages 981 px wider than a phone), and
  serious contrast/ARIA issues.
- No health endpoint.

**Deployment:** see **DEPLOYMENT.md** (environment variables, migrations,
startup, storage, reverse proxy limits, backup/restore, smoke tests,
rollback, external integration options, go-live checklist).

**Owner decisions / external providers required before launch:**
- password recovery (none exists);
- manual vs online payments;
- TLS domain + proxy;
- production Postgres with scheduled backups;
- a persistent storage volume.

Video transcoding/HLS/CDN/DRM, email/SMS, scheduled jobs and CAPTCHA are
external and optional for a small launch.

### Release-candidate gate (2026-09-26)

An independent pass against the code, not earlier reports. It covered:
- an inventory of all 89 server actions and 17 API routes;
- live IDOR, after-logout and concurrency attacks;
- the learning-flow and lifecycle leak checks;
- a responsive audit at 390/768/1280 px;
- a full deployment reproduced from a fresh clone.

**Real defects found and fixed** (each with a regression test that fails
on the previous code):
1. **Login lockout.** Parallel guesses bypassed it: 24 of 25 were
   evaluated, and the correct password was accepted.
2. **Study time.** Parallel activities multiplied real time: 60 s was
   credited as 240 s.
3. **Sequential unlocking** was not enforced by the video APIs: a locked
   lesson's playback URL, stream, heartbeats and notes were all allowed.
4. **Teacher `photoUrl`** accepted javascript:/data: values.
5. **`npm ci` failed** on a clean checkout (ERESOLVE, `@types/node`).
6. **`npm run build` needed a production database**, because `/shorts`
   was prerendered.
7. **Dead code:** an unused `POST /api/watch-sessions`.
8. **Stale docs:** the README was the create-next-app boilerplate,
   recommending Vercel (unsafe with local private storage), and
   ARCHITECTURE described the proxy as edge middleware.

**Verified with no finding:**
- ownership checks on every ID-taking action/API;
- server actions and APIs after logout;
- answer-key and secret leakage;
- draft titles hidden from students;
- payment transitions;
- file-upload paths (only 3, all teacher-only and magic-byte checked);
- fail-closed startup (8 unsafe configurations);
- backup → restore → restart with byte-identical files.

### Go-live blocker closure (2026-09-26)

**Implemented** (details, evidence and commits in FINAL_AUDIT_REPORT.md →
"Go-Live Blocker Closure"):
- **Password recovery and change**, available to every role:
  - `/forgot-password` → `/reset-password`, plus `/account/password`;
  - hashed, single-use, short-lived tokens;
  - the same answer for existing and unknown emails;
  - per-email rate limiting;
  - every session ends after a reset or change.
- **No email provider is integrated**, so in production the self-service
  link is not sent and the page says so. Working paths:
  - a teacher-issued one-time link in `/teacher/accounts` for students
    and parents;
  - `npm run password:reset-link` for the teacher account.
- **Sessions that really end:** every protected request re-checks the
  account (blocked / reset / changed), and sign-out revokes that session
  server-side.
- **Fail-closed production configuration:** an https `AUTH_URL` and a
  `STORAGE_ROOT` outside `public/` are required. Verified behind nginx
  TLS.
- **Uploads:**
  - videos are checked by content, and the extension comes from the
    content;
  - replacing a video no longer deletes the old file first, and no
    longer publishes a draft.
- **Payments:** reject and refund are atomic, like confirm. Manual/offline
  payment was re-verified and kept.
- **Streaming:** byte ranges follow RFC 9110.
- **DEPLOYMENT.md** was rewritten: topology, the tested proxy config,
  storage, backups (frequency, retention, verification), smoke checklist,
  rollback, and payment-gateway prerequisites.

**Real bugs found this round:**
- invalidated sessions could still read pages via client navigation;
- sign-out was silently undone by in-flight prefetches;
- a payment reject racing a confirm both succeeded;
- login `callbackUrl` open redirect;
- range requests past the end got 416, and suffix ranges were wrong;
- video replace deleted the old file first and re-published drafts;
- unsafe production configurations were accepted;
- the documented nginx config broke shorts uploads over 30 MB.

**Launch blockers remaining (owner only):**
- domain + TLS proxy;
- production PostgreSQL with scheduled backups and one test restore;
- a persistent `STORAGE_ROOT` volume;
- recorded decisions on manual payments and the reset procedure.

## Not started (by priority order, all schema-ready)

Real payment gateway integration, HLS/DRM, email/SMS delivery (password
reset links and notifications).

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
10. ~~**No real simulation/game engine for experiments.**~~ **Closed
    2026-09-25**: drag & drop, ordering activity, mini game and formula
    simulation each have their own renderer and server-side grading.
    Original note: `SIMULATION`,
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
16. **Reports are teacher-triggered, not scheduled.** A real deployment
    would run `generateParentReport()` from a monthly cron job; nothing
    in this environment can run one, so a teacher generates each report
    by hand for now (see the same note on `syncExpiredSubscriptions()`).
17. ~~**No PDF export.**~~ **Closed 2026-09-25** (printable report +
    browser Save-as-PDF; `pdfUrl` stays unused because nothing is stored
    server-side). Original note: `ParentReport.pdfUrl` exists in the schema and is
    always `null` — the report is a real data snapshot rendered as an
    HTML page, not a downloadable file, since no PDF-rendering pipeline
    is available here.
18. **No real game-rendering engine.** Games are a real, functional timed
    multiple-choice round, not a canvas/arcade-style experience — no game
    engine is available in this environment (same category of honest gap
    as Phase 7's experiments).
19. ~~No leaderboards yet reading `GameSession.score`~~ — **fixed in
    Phase 13**: `recomputeLeaderboard()`/`getLeaderboard()` compute real
    daily/weekly/monthly rankings from `GameSession.score`, and Hall of
    Fame candidates are proposed from the same real scores (never shown
    publicly until a teacher approves).
20. **No `CUSTOM` leaderboard period UI.** `LeaderboardPeriod.CUSTOM` exists
    in the schema; `getPeriodKey()` deliberately throws for it since a
    custom period needs an explicit `periodKey` with no date-derived
    default, but no teacher-facing flow to define one was built this
    phase — only `DAILY`/`WEEKLY`/`MONTHLY` are selectable.
21. **Hall of Fame candidate generation is teacher-triggered, not
    scheduled** — same "no scheduler in this environment" honesty note as
    `syncExpiredSubscriptions()` and Phase 10's reports; a real deployment
    would run `generateHallOfFameCandidates()` from a monthly cron job.
22. ~~`evaluateStreakForDay()` was never called from any route~~ — **fixed
    in Phase 14**: wired into `/api/study/heartbeat/route.ts`, so
    `Streak.currentStreak`/`longestStreak` (shown on the student dashboard
    and used by the new `STREAK_DAYS` achievement metric) now actually
    update from real daily activity against the
    `DAILY_STREAK_MIN_ACTIVE_MINUTES` platform setting.
23. **No teacher-facing edit/delete for achievements.** `/teacher/achievements`
    supports create + award-to-student only — there is no update or
    delete form, matching the "never delete a feature/data silently"
    stance and avoiding a foreign-key conflict with existing
    `StudentAchievement` rows.
24. **The career exploration quiz is a fixed 5-question set in code, not
    teacher-editable.** There is no `CareerQuizQuestion` model in the
    schema, so the questions/trait tags live in
    `CAREER_QUIZ_QUESTIONS` — a teacher can shape which fields the quiz
    can suggest (via each field's `traits`), but not the questions
    themselves. Adding a real question-editor would need a new schema
    model.
25. **No `roadmap`/`resources` authoring UI.** `CareerField.roadmap` and
    `.resources` (`Json?`) exist in the schema for richer structured
    content but are never populated by `/teacher/career-fields` — no
    clear structure for them was in scope this phase; they stay `null`
    until a real content format is designed.
26. **No teacher-facing edit for career fields** — `/teacher/career-fields`
    supports create + delete only, same category of gap as achievements
    above.
27. **A referrer with no subscription at all never receives a pending
    referral reward** — see the "Honest, documented gap" note in the
    Certificates & Referral section above; the reward stays pending
    rather than fabricating an entitlement.
28. ~~**No certificate PDF/image generation**~~ **Closed 2026-09-25**
    (printable certificate page with a QR code). Original note: — `/certificates/verify/[code]`
    is a real, permanent, publicly verifiable HTML record, but there is
    no downloadable certificate document (same category of gap as
    Phase 10's report PDF export — no rendering pipeline available here).
29. **Referral fraud prevention is minimal** — a student could register
    many throwaway accounts with a referral code and have each one
    subscribe via a free promo code to farm rewards; there is no
    rate-limiting or identity verification here, the same honest
    limitation already noted for parent-link requests in Phase 9.
30. **The store has no real payment gateway, same as subscriptions** —
    `CONFIRMED` is a manual "I verified real money arrived" action by a
    teacher/admin (cash, bank transfer, ...), not an automated charge.
    See the Store section above for why this reuses `OrderStatus`
    instead of the `Payment` model.
31. **No shipping address / delivery details on an Order** — the schema
    has no field for one, so `SHIPPED`/`DELIVERED` are teacher-declared
    milestones with no logistics data attached; a real deployment would
    need a schema addition for this.
32. **No image upload for products** — `Product.images` (`String[]`)
    exists in the schema but `/teacher/products` doesn't populate it
    (no file upload wired up this phase, same category of gap as
    lesson-video uploads being the only wired-up file upload path so
    far); products are text/price/stock only for now.
33. **`AnnouncementAudience.GROUP` is unsupported, on purpose.** No
    `Group`/`StudentGroup` model exists anywhere in the schema to back
    it — `resolveAnnouncementStudentIds()` throws a clear error rather
    than silently notifying zero people. Adding real group targeting
    would need a new schema model.
34. **No per-recipient read/seen tracking for an `Announcement` itself**
    (unlike `Notification.readAt`) — a student/parent's announcements
    page always shows every applicable announcement ever published,
    with no "unread" distinction of its own; the real unread signal
    lives on the fanned-out `Notification` row instead (via the
    existing 🔔 bell's `readAt`/mark-all-read).
35. **Search has no per-item detail pages to link to for `Course`,
    `Product`, or `CareerField`** — those results are informational
    (title + context) rather than clickable, since no such page exists
    anywhere in the app yet (see the Search section above). Adding one
    would let search link there without any change to `search.ts`
    itself.
36. **Search is a simple `contains`/case-insensitive title match**, not
    full-text/fuzzy search — a typo or a search by body/description
    text (beyond `QuestionBank.description`) won't match. Real full-text
    search would need a dedicated search index/extension not set up in
    this environment.
37. **No search for parents** — parents don't browse course content
    directly, so search was scoped to student + teacher only, the same
    reasoning Phase 19 used to skip COURSE/CATEGORY announcements for
    parents.

## Test status

```
npx vitest run       # 504/504 passing (46 files)
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

Verified end-to-end with a real Playwright browser suite (final audit,
18/18 steps passing): student registration → teacher builds a category,
course, two lessons (one gated behind the other), uploads videos, and
creates a lesson quiz → free lesson A appears on the student dashboard →
lesson B is genuinely locked (real page, real locked-state message) until
lesson A's quiz is passed through the actual exam UI → lesson B unlocks
and its video renders → a second student's already-open session loses
access the instant the teacher blocks them, with no new login involved →
login rate limiting rejects even a correct 6th password after 5 wrong
ones → global search finds the new course → achievements page loads.
Full narrative and the one real bug this pass caught are in
`FINAL_AUDIT_REPORT.md`'s "E2E Findings" section.

Release-candidate gate, final build (2026-09-26):
- MUST FIX 32/32, journey 12/12, stress 10/10, original 26/26, CSRF 5/5.
- Password 14/14, smoke 19/19, TLS 8/8.
- Release-gate attacks 11/11; lifecycle leak check pass.
- Responsive/a11y: 23 pages × 390/768/1280 px clean.
- Clean-clone deployment reproduction: all steps pass, journey 12/12 on
  the fresh install.

Verdict: **READY AFTER OWNER INFRASTRUCTURE SETUP** (FINAL_AUDIT_REPORT.md).

Browser E2E on the final build of the go-live blocker round (2026-09-26):
- MUST FIX 32/32, journey 12/12, stress 10/10, original 26/26, CSRF 5/5.
- Password recovery (new) 14/14.
- Production smoke (new) 19/19.
- TLS reverse proxy (nginx, new) 8/8.

Earlier (production-readiness round, 2026-09-25):
- MUST FIX suite: 32/32.
- Full role journey: 12/12.
- HTTP security/concurrency stress: 10/10.
- Original targeted suite: 26/26.
- CSRF login suite: 5/5.
- Mobile/accessibility audit: 21 pages, 0 px overflow, no serious or
  critical axe violations.

Earlier (MUST FIX round):
- MUST FIX suite: 32/32 steps passing, covering MF#1–#5 and the SHOULD FIX schema
  work, including direct API / server-action replay negatives.
- Original targeted suite: 26/26.
- Fresh-browser CSRF login suite: 5/5.

## Next recommended step

All code-side go-live blockers are closed. What remains open, and what
each item needs before it can move:
1. **Owner infrastructure** (launch blockers, DEPLOYMENT.md §13):
   - a domain + TLS proxy;
   - production PostgreSQL with scheduled off-host backups and one test
     restore;
   - a persistent `STORAGE_ROOT` volume.
2. **Owner decisions:**
   - launch with manual/offline payments (#49);
   - the password-reset procedure without email, or add a provider
     (#51);
   - whether promo percentages may be fractional (`PromoCode.value`,
     intentionally unchanged).
3. **External providers (optional for a small launch):** payment
   gateway, HLS/DRM/CDN, email/SMS, cron, CAPTCHA, monitoring (PDF is
   handled in-app by the browser print flow).
4. **Product decision:** concurrent-session detection/limits. The
   per-session id and database check added in this round (sign-out
   revocation) are the foundation; limiting simultaneous sessions is
   not implemented.
