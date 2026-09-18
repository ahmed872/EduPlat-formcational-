# Architecture

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript, React 19) — a single
  modular monolith, not microservices. Server Components render dashboards
  directly from the database; Server Actions and Route Handlers implement
  mutations and JSON APIs.
- **Database**: PostgreSQL, accessed through Prisma ORM (`prisma/schema.prisma`).
- **Auth**: NextAuth v5 (Credentials provider), JWT sessions. Role-based
  access control (`STUDENT`, `PARENT`, `TEACHER_ADMIN`) enforced both in
  `src/proxy.ts` (Next.js's edge-level middleware, renamed "Proxy" in
  Next 16) and again inside every server component/route/action via
  `src/lib/rbac.ts` — routing alone is never trusted.
- **Testing**: Vitest, running business-logic tests against a real,
  disposable PostgreSQL database (`eduplat_test`), not mocks — the tests
  exercise actual Prisma queries and transactions.
- **Styling**: Tailwind CSS v4, RTL-first (`dir="rtl"`, `lang="ar"` on
  `<html>`), Arabic UI copy throughout. English can be added later via a
  standard i18n layer without restructuring.

## Module layout

```
src/
  auth.ts / auth.config.ts   NextAuth setup (split so proxy.ts stays edge-safe)
  proxy.ts                   Route-level RBAC gate for /teacher, /parent, /student
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

## Video delivery (intentionally not implemented yet)

The `Video` model stores `storageProvider` + `storageKey` (a private
reference, never a public URL) so a real provider (Cloudflare Stream, Mux,
or S3 + signed CloudFront/HLS URLs) can be plugged in later. The
authorization gate (`checkVideoAccess`) and the watch-session/view-limit
system are fully implemented and tested; only the "hand the browser a
playable, signed, expiring URL" step is a stub, honestly labeled as such on
the watch page (see PROJECT_STATUS.md → Known gaps).

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
