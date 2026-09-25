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
  `Attachment` (lesson files: private `storageKey`, sanitized
  `originalName`, detected `mimeType`, `sizeBytes` — served only by
  `/api/attachments/[id]`), `StudentNote`, `Bookmark`.
- **Content status**: `Course`, `Lesson` and `Video` each carry
  `status` (`DRAFT` / `PUBLISHED` / `ARCHIVED`). The effective state of a
  video is the "weakest" along video → lesson → course: any `DRAFT` hides
  it from everyone; otherwise any `ARCHIVED` makes it archived (existing
  entitlement holders keep access; no listings, search, free access or new
  grants). See `src/lib/business/content-visibility.ts`.
- **Assessment**: `QuestionBank` → `Question` → `Quiz` → `QuizQuestion` (join
  with per-question points) → `QuizAttempt` → `QuizAnswer`. `Quiz.examType`
  distinguishes lesson quizzes from weekly/monthly/midterm/final/custom exams
  without needing separate tables.
- **Commerce/access** (the most important group — see ARCHITECTURE.md):
  `SubscriptionPlan` → `SubscriptionPlanItem` (what the plan *includes*) →
  `Subscription` (what a student *bought*; `status` is
  `PENDING_PAYMENT → ACTIVE → EXPIRED|CANCELLED`, optionally tagged with the
  `PromoCode` used at checkout) → `Entitlement` (the actual, auditable
  per-video/lesson grant, snapshotted at purchase time; `subscriptionId`
  null for a standalone PROMO/FREE/ADMIN_GRANT, with its own optional
  `expiresAt` for time-boxed grants like `FREE_PERIOD`, and `grantedById`
  recorded for `ADMIN_GRANT`) → `WatchSession` (one row per playback
  attempt, `consumedView` + `viewNumber` set only once a session crosses
  the configured completion threshold). `Payment` is provider-agnostic
  (`provider`/`providerRef`/`method`/`notes`/`confirmedById`/`failureReason`)
  and hangs off `Subscription`, tracking both `originalAmountCents` (before
  a promo discount) and the final `amountCents`. `PromoApplicableContent`
  links a `PromoCode` to the `Course`/`Lesson`(s) it grants directly, used
  by `FREE_LESSON`/`FREE_PACKAGE`/`FREE_PERIOD` types independently of any
  subscription.
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
- **Experiments**: `Experiment.config` is a versioned JSON document (`v: 2`)
  validated per `type` by the registry in `src/lib/experiments/definitions.ts`
  (it contains the answer key and is never sent to the browser as-is).
  `ExperimentAttempt` is open while `completedAt` and `endedAt` are both
  null; `completedAt` = passed, `endedAt` without `completedAt` = a failed /
  expired round; `resultJson` holds tries, scores and the mini-game state.
- **Career/certification**: `CareerField`, `CareerExplorationResult`,
  `Certificate` (public verification by `certificateCode`; `revokedAt` /
  `revokedReason` for teacher revocation), `ReferralReward` (`rewardType`
  is the `ReferralRewardType` enum, `rewardValue` an integer number of
  days).
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

## Referential integrity

Every column that stores another row's id is a real foreign key. The seven
columns that point at `User` for ownership or "who did it" —
`User.blockedById`, `Course.teacherId`, `QuestionBank.teacherId`,
`QuizAnswer.reviewedById`, `Entitlement.grantedById`,
`Payment.confirmedById`, `HallOfFameEntry.approvedById` — are
`ON DELETE RESTRICT`: accounts are blocked, never deleted, and a user who
owns content or appears on an audited row cannot be hard-deleted out from
under it.

`Entitlement.lessonId` / `videoId` are also `RESTRICT` (they used to be
Prisma's implicit `SET NULL`, which would have silently turned a student's
grant into a row pointing at nothing if a lesson were deleted). Deleting
entitled content — directly, or via the lesson → course cascade — now
fails; unpublishing/archiving only changes `status` and is unaffected. No
application code path deletes courses, lessons, videos or users.

## Migrations

All migrations are hand-reviewed. Destructive or type-changing ones start
with a preflight `DO $$ … RAISE EXCEPTION` block that checks the data and
aborts **before any DDL** if applying would lose or orphan anything, so a
failed deploy leaves the database untouched:

| Migration | What | Guard |
|---|---|---|
| `20260918144836_init` … `20260919123819_login_attempt_and_rate_limit` | Initial schema and phase additions | additive |
| `20260920000000_final_audit_integrity_fixes` | Unique constraints behind race fixes | additive |
| `20260924000000_game_mini_cooldown`, `20260924000100_notification_dedupe_key` | Gap-round unique keys | additive |
| `20260925000000_experiment_attempt_ended_at` | `ExperimentAttempt.endedAt` (backfilled from `completedAt`) | additive |
| `20260925010000_private_lesson_attachments` | `Attachment.fileUrl` → private storage columns | aborts if any Attachment row exists (none were ever created by the app) |
| `20260925020000_certificate_revocation` | `Certificate.revokedAt` / `revokedReason` | additive |
| `20260925030000_user_relation_foreign_keys` | 7 User FKs + Entitlement RESTRICT | aborts listing each column with orphaned ids |
| `20260925040000_referral_reward_types` | `rewardType` → enum, `rewardValue` → `INTEGER`, converted in place with `USING` | aborts on unknown types or non-integer / out-of-range values |
| `20260926000000_watch_session_served_buckets` | `WatchSession.servedBuckets INTEGER[]` (server-delivered coverage for view accounting) | additive |

Before the FK migration was written, the development data was checked
with an orphan query per column (all 0); both guards were also exercised
against deliberately broken rows inside a rolled-back transaction.
`PromoCode.value` is intentionally unchanged (its meaning depends on
`type`, which is a product decision, not a typing fix).

All 19 migrations were verified end-to-end twice:
- `migrate deploy` on an empty database;
- an upgrade of a populated copy (2,002 users, 20,000 watch sessions),
  with row counts identical afterwards.

A deliberately orphaned row made the FK migration abort before its DDL.
Recovery was then exercised: repair the data,
`migrate resolve --rolled-back <name>`, `migrate deploy`. The exact
procedure is in DEPLOYMENT.md §4.
