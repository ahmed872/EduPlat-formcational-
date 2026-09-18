# Database

PostgreSQL, managed with Prisma migrations (`prisma/migrations/`). The full
schema lives in `prisma/schema.prisma`; this file explains the shape and the
non-obvious relationships rather than repeating every field.

## Setup

```bash
createdb eduplat            # or point DATABASE_URL at any Postgres instance
cp .env.example .env        # fill in DATABASE_URL / AUTH_SECRET
npm run db:migrate          # applies migrations
npm run db:seed             # platform defaults + a teacher/admin account
```

Tests run against a second database (`eduplat_test`, configured in
`.env.test`) so `npm test` never touches development data. Prisma migrations
are applied to it automatically by Vitest's `globalSetup`.

## Entity groups

- **Auth**: `User` (one row per login identity, carries `role`) →
  `StudentProfile` / `ParentProfile` / `TeacherProfile` (1:1, role-specific
  data). `ParentStudent` is an explicit many-to-many join — a parent only
  ever sees a student through a row here, never by inference.
- **Structure**: `Category` (self-referential, teacher-defined depth/labels —
  no hardcoded "Primary/Prep/Secondary" stages anywhere), `Course`, `Lesson`.
  `Lesson.requiredPreviousLessonId` is a self-relation used for sequential
  unlocking.
- **Media**: `Video` (private `storageKey`, never a public URL),
  `VideoChapter`, `Short` (optionally linked to a source `Video` + timestamp),
  `Attachment`, `StudentNote`, `Bookmark`.
- **Assessment**: `QuestionBank` → `Question` → `Quiz` → `QuizQuestion` (join
  with per-question points) → `QuizAttempt` → `QuizAnswer`. `Quiz.examType`
  distinguishes lesson quizzes from weekly/monthly/midterm/final/custom exams
  without needing separate tables.
- **Commerce/access** (the most important group — see ARCHITECTURE.md):
  `SubscriptionPlan` → `SubscriptionPlanItem` (what the plan *includes*) →
  `Subscription` (what a student *bought*) → `Entitlement` (the actual,
  auditable per-video/lesson grant, snapshotted at purchase time) →
  `WatchSession` (one row per playback attempt, `consumedView` +
  `viewNumber` set only once a session crosses the configured completion
  threshold). `Payment` is provider-agnostic and hangs off `Subscription`.
- **Progress/time**: `LessonProgress` (unlock state per student/lesson),
  `StudyActivitySession` (heartbeat-accumulated active seconds, one open row
  per student+type+ref), `DailyStudyStat` (pre-aggregated per day for fast
  dashboard reads), `Target`, `Streak`.
- **Engagement**: `Achievement`/`StudentAchievement`, `Game`/`GameSession`,
  `LeaderboardSnapshot` (a cache recomputed from `GameSession`, not a live
  join, since ranking queries would otherwise be expensive at scale),
  `HallOfFameEntry` (requires `approved` before public display).
- **Promotions**: `PromoCode`, `PromoApplicableContent`, `PromoRedemption`
  (unique per student+promo — see `promo-code.ts`).
- **Communication**: `TeacherNote` (private, teacher-only), `ParentReport`,
  `Notification`, `Announcement`, `LessonQuestion`/`LessonQuestionReply`,
  `LessonFeedback`.
- **Career/certification**: `CareerField`, `CareerExplorationResult`,
  `Certificate` (public verification by `certificateCode`), `ReferralReward`.
- **Support/store**: `SupportTicket`/`SupportTicketReply`/`SupportTicketAttachment`,
  `Product`/`Order`/`OrderItem`.
- **Governance**: `AuditLog` (actor, action, entity, metadata — written by
  admin-facing mutations), `PlatformSetting` (key/JSON value — see
  `src/lib/platform-settings.ts`).

## Indexing

Foreign keys used in hot lookups are indexed explicitly (`@@index`) beyond
what Prisma adds automatically for relations — e.g. `Video.status`,
`WatchSession` by `[studentId, videoId]`, `Entitlement` by
`[studentId, videoId]` and `[studentId, lessonId]`, `Notification` by
`[userId, readAt]`.

## What's migrated vs. not yet

One migration exists so far: `20260918144836_init`, containing the entire
schema above. No destructive migrations have been run. Future phases (Shorts
UI, games, career guidance content entry, etc.) will add data through this
existing schema rather than altering it, except where a feature genuinely
needs a new column/table.
