# Deployment Guide — EduPlat

This guide covers self-hosting EduPlat in production. Every command below
was run during the production-readiness audit (2026-09-25) against a
production build (`next build` + `next start`). Where a step depends on
something the owner must supply (a domain, a payment provider, …), it says
so explicitly. **No external integration (payment gateway, video CDN, email,
SMS, CAPTCHA, monitoring SaaS) is configured or tested in this repository.**

---

## 1. What you are deploying

- One Next.js 16 Node.js server process. It serves pages, APIs and private
  media through access-checked routes.
- One PostgreSQL 16 database.
- One persistent directory for private uploads (`STORAGE_ROOT`: lesson
  videos and attachments). Files are served only through
  `/api/stream/*` and `/api/attachments/*`, never as static files.
- A reverse proxy you provide (nginx, Caddy, a cloud load balancer). It
  terminates TLS and enforces per-path body-size and rate limits.

**Single instance only, as shipped.** Private files live on local disk and
there is no shared cache, so run exactly one app instance unless
`STORAGE_ROOT` is on shared storage that every instance mounts. See §11 for
object storage. The database can scale independently.

Tested versions: Node.js 22.22 (npm 10.9), PostgreSQL 16.13, Next.js
16.3.5, Prisma 6.19, Auth.js (next-auth) 5.0.0-beta.32.

---

## 2. Environment variables

Set these in the process environment. Real environment variables override
`.env`. Never commit real values; `.env.example` holds placeholders only.
The server validates them at startup: in production, an invalid
configuration **stops the process** with a message that names the
variable but never shows its value (see §7).

| Variable | Required | Purpose / format |
|---|---|---|
| `DATABASE_URL` | **yes** | `postgresql://USER:PASSWORD@HOST:5432/DBNAME`. The DB user must own the schema, because it runs migrations. |
| `AUTH_SECRET` | **yes** | Signs sessions, video playback tokens and attachment download tokens. At least 32 random characters: `openssl rand -base64 48`. Changing it logs everyone out and invalidates outstanding links. |
| `AUTH_TRUST_HOST` | **yes***, or `AUTH_URL` | `true` when running behind your own reverse proxy / host. Without it (or `AUTH_URL`), Auth.js rejects **every** request with `UntrustedHost`. |
| `AUTH_URL` | *alternative to the above* | The public origin, e.g. `https://edu.example.com`. |
| `NEXTAUTH_URL` | recommended | The public origin (`https://…`). Used for auth callbacks and as the fallback origin for certificate QR codes. |
| `APP_BASE_URL` | recommended | The public origin encoded in certificate QR codes. If unset, `AUTH_URL` then `NEXTAUTH_URL` is used, and the request host only as a last resort. |
| `STORAGE_ROOT` | **yes in production** | Absolute path of the persistent private-upload volume, e.g. `/var/lib/eduplat/storage`. Default: `./storage` inside the app directory, which is **lost** when a container is replaced. |
| `SEED_TEACHER_EMAIL` | first deploy only | Email of the first teacher/admin account created by the seed. |
| `SEED_TEACHER_PASSWORD` | first deploy only | At least 12 characters. It is never printed. The seed **refuses to run in production without it**, so there is no default admin password in production. |
| `NODE_ENV` | set by `next start` | `production`. Enables the strict startup checks and HSTS. |
| `PORT` / `-p` | optional | Listen port (default 3000). |

---

## 3. First deployment (fresh database)

```bash
# 0. Code at the release commit, with dependencies installed (dev
#    dependencies too: the seed uses tsx, and the build needs TypeScript).
git checkout <release-tag-or-commit>
npm ci

# 1. Database: an empty database owned by the app's DB user.
#    (Example for a self-managed Postgres; managed Postgres: create it in the console.)
sudo -u postgres createdb -O eduplat eduplat

# 2. Apply all migrations (19 as of this guide). Idempotent: it applies only pending ones.
DATABASE_URL=... npx prisma migrate deploy
DATABASE_URL=... npx prisma migrate status        # → "Database schema is up to date!"

# 3. Seed platform settings + the first teacher/admin account (once).
NODE_ENV=production DATABASE_URL=... \
  SEED_TEACHER_EMAIL=admin@your-domain SEED_TEACHER_PASSWORD='<12+ chars>' \
  npm run db:seed
#    Re-running is safe: settings are upserted, and an existing account is left unchanged.

# 4. Build.
npx prisma generate
npm run build

# 5. Private storage volume, writable only by the app user.
sudo mkdir -p /var/lib/eduplat/storage && sudo chown <app-user> /var/lib/eduplat/storage && sudo chmod 700 /var/lib/eduplat/storage

# 6. Start (under systemd, a container runtime, pm2, …).
NODE_ENV=production DATABASE_URL=... AUTH_SECRET=... AUTH_TRUST_HOST=true \
  NEXTAUTH_URL=https://edu.example.com APP_BASE_URL=https://edu.example.com \
  STORAGE_ROOT=/var/lib/eduplat/storage \
  npm start -- -p 3000
```

A healthy start logs `[startup] configuration and private storage checks passed`.

**After the first login:** set the academic-year end under platform
settings. Checkout refuses to sell a subscription once the configured
academic-year end has passed, and the seed default is 31 July of the
following year.

---

## 4. Upgrading an existing installation

```bash
# 1. Back up first (§8). Keep this dump until the release is confirmed good.
pg_dump "$DATABASE_URL" -Fc -f eduplat_pre_<release>.dump
# 2. Stop the app (or drain it), deploy the new code, build.
npm ci && npx prisma generate && npm run build
# 3. Migrate, then check.
npx prisma migrate deploy && npx prisma migrate status
# 4. Start and run the smoke tests (§9).
```

Verified during the audit on a copy of the pre-release schema holding
2,002 users, 5,000 entitlements, 20,000 watch sessions, 1,500 referral
rewards, 3,000 experiment attempts and 300 certificates:
- The 6 pending migrations applied in **1.85 s**.
- Every row count and the referral-days total were identical before and
  after.
- `rewardValue` became `integer` and `rewardType` the enum.
- `ExperimentAttempt.endedAt` was back-filled for all 1,500 completed
  attempts, and all 9 foreign keys are RESTRICT.

### If a migration fails

The migrations that could lose or orphan data first run a check and
**abort before changing anything**. The error names the problem, e.g.
`Orphaned user references found (column=rows): Course.teacherId=1 … nothing was changed.`
Recovery, tested end-to-end:

```bash
npx prisma migrate status            # shows which migration failed
# Fix the data the message names, e.g. re-point the orphaned rows:
psql "$DATABASE_URL" -c 'UPDATE "Course" SET "teacherId"=<existing teacher id> WHERE "teacherId"=<missing id>'
npx prisma migrate resolve --rolled-back <failed_migration_name>
npx prisma migrate deploy            # re-applies it and continues
```

Never use `prisma migrate dev` or `prisma db push` against production.

---

## 5. Reverse proxy (required)

The app sets its own security headers (X-Frame-Options DENY, a CSP with
`frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy,
and HSTS in production). The proxy must provide TLS and the limits below.
The app's Server Action body limit is 500 MB, **globally**: that is the
only way the video upload action works. Restrict it per path at the proxy.

Example (nginx):

```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=api:10m  rate=10r/s;

server {
  listen 443 ssl http2;
  server_name edu.example.com;
  # ssl_certificate / ssl_certificate_key …

  client_max_body_size 30m;                       # everything else (attachments ≤ 25 MB)
  location /teacher/courses/ {                     # video upload action lives here
    client_max_body_size 500m;
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:3000;
  }
  location /api/auth/  { limit_req zone=auth burst=20 nodelay; proxy_pass http://127.0.0.1:3000; }
  location /register   { limit_req zone=auth burst=10 nodelay; proxy_pass http://127.0.0.1:3000; }
  location /api/       { limit_req zone=api burst=40 nodelay;  proxy_pass http://127.0.0.1:3000; }
  location /           { proxy_pass http://127.0.0.1:3000; }

  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 300s;                         # long video range responses
}
```

Rate limiting that already exists in the app is login throttling per
email only (5 failures per 15 minutes, configurable). Registration,
heartbeats and playback-URL issuance have no in-app rate limit; the proxy
limits above cover them.

---

## 6. Private storage

- Layout: `$STORAGE_ROOT/videos/<uuid>.mp4` and
  `$STORAGE_ROOT/attachments/<uuid>.<ext>`. File names are random, and the
  uploaded name is kept only in the database.
- New directories are created with mode 700 and files with 600. At startup
  the server creates the directories if they are missing and runs a write
  probe with a 5-second limit. If the probe fails in production, the
  process exits. Tested with an unwritable path (`ENOTDIR`) and a hanging
  mount (`TIMEOUT`).
- Verified: files written through the UI were served byte-identical after
  a server restart, and anonymous requests were still refused.
- **Video format:** there is no transcoding. Teachers must upload
  browser-playable MP4 (H.264 video + AAC audio, `faststart`). Playback
  uses HTTP range requests through the app process, so video bandwidth
  passes through Node. That is fine for a small launch; see §11 for
  scale.
- **Back up this directory together with the database** (§8). A database
  restore without the matching files gives 404s on playback and
  downloads.

---

## 7. Startup behavior and logs

At startup, `src/instrumentation.ts` → `src/lib/startup.ts` checks:
- `DATABASE_URL` is present and is a postgres URL;
- `AUTH_SECRET` is at least 32 characters and not the placeholder;
- `AUTH_TRUST_HOST` or `AUTH_URL` is set;
- URL formats are valid, and `STORAGE_ROOT` is absolute;
- private storage is writable.

In production any error means `exit 1`. Verified cases: a missing
`AUTH_TRUST_HOST`, a weak secret, and unwritable or hanging storage all
exit 1, and no secret appeared in the logs.

Logs go to stdout/stderr:
- Server errors are one JSON line each: method, path **without query
  string** (signed tokens live there), route, digest and message. They
  never include headers or cookies.
- `[startup] …` lines report the configuration checks.
- `[stream] delivery accounting failed` appears only if view accounting
  hits a database error.

Ship these lines to your log system.

Health check: `GET /api/health` returns `200 {"status":"ok"}`, or
`503 {"status":"unavailable"}` when the database is unreachable. The
details go only to the server log. Use it for the load balancer and the
uptime monitor.

---

## 8. Backups and restore

**What to back up:**
1. The database: `pg_dump -Fc`.
2. `STORAGE_ROOT`.

Take both at the same time. Nightly at minimum, plus immediately before
every upgrade.

```bash
# Backup (example cron at 02:30; keep ≥ 14 days, copy off-host/encrypted)
pg_dump "$DATABASE_URL" -Fc -f /backups/eduplat_$(date +%F).dump
tar -C /var/lib/eduplat -czf /backups/eduplat_storage_$(date +%F).tgz storage

# Restore into a NEW database (never over the live one first)
createdb -O eduplat eduplat_restore
pg_restore --no-owner -d "postgresql://…/eduplat_restore" /backups/eduplat_<date>.dump
DATABASE_URL=postgresql://…/eduplat_restore npx prisma migrate status   # schema matches the code?
tar -C /var/lib/eduplat -xzf /backups/eduplat_storage_<date>.tgz        # restore files
# Point DATABASE_URL at the restored DB (or rename databases) and restart the app.
```

Verified during the audit:
- The dev database, copied with this procedure, restored with identical
  counts: 181 users, 41 courses, 59 lessons, 7 entitlements, 76 watch
  sessions, 16 quiz attempts, 4 certificates, 3 attachments and 39 audit
  rows.
- `migrate status` reported "up to date" on the copy.
- The pre-upgrade dump of the populated test database also restored with
  identical counts.

**Backups are not automated by this repository.** The owner or host must
schedule them (cron / managed-Postgres PITR) and run a test restore at
least once before launch.

---

## 9. Smoke tests after every deploy

```bash
BASE=https://edu.example.com
curl -fsS $BASE/api/health                                   # {"status":"ok"}
for p in / /login /register /shorts; do curl -s -o /dev/null -w "$p %{http_code}\n" $BASE$p; done   # 200
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $BASE/teacher                                # 307 → /login
curl -s -o /dev/null -w "%{http_code}\n" $BASE/nonexistent                                            # 404
curl -sI $BASE/login | grep -iE "x-frame-options|content-security-policy|strict-transport"             # headers present
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/attachments/x                                      # 401 (no session)
```

Then check by hand in a browser:
1. The admin logs in.
2. The admin opens `/teacher/payments`. The page states that payment is
   manual.
3. A test student registers, subscribes to a plan, and sees
   «الدفع يدوي خارج المنصة».
4. The admin confirms that payment. The student can then play a lesson
   and download its attachment.

The repository's Playwright suites automate these journeys against any
base URL. See `FINAL_AUDIT_REPORT.md` → Production Readiness for their
last results.

---

## 10. Rollback

- **App-only rollback (no new migrations in the release):** redeploy the
  previous build/commit and restart.
- **Release that included migrations:** migrations are forward-only; there
  are no down-migrations.
  - The safe rollback is: stop the app, restore the pre-upgrade dump
    (§4 step 1) into a new database, switch `DATABASE_URL`, and redeploy
    the previous build.
  - Data written after the dump is lost, so decide quickly, or fix
    forward.
  - The 2026-09-25 migrations can be forward-fixed. Only
    `20260925010000_private_lesson_attachments` drops a column: the
    never-used `Attachment.fileUrl`. It aborts if any attachment rows
    exist.
- Changing `AUTH_SECRET` during a rollback logs every user out. Keep it
  unchanged.

---

## 11. External integrations — status and options

Nothing in this section is configured or tested with real credentials. The
application has an abstraction or seam for each item. "Launch blocker"
means the platform should not go live without it.

| Area | Status in code | Launch? | Supported path and prerequisites |
|---|---|---|---|
| TLS, domain, reverse proxy | not in repo | **Blocker** | Owner supplies a domain, a certificate (e.g. Let's Encrypt), and the proxy in §5. |
| Production PostgreSQL + backups | procedure only (§8) | **Blocker** | Managed Postgres with PITR (e.g. AWS RDS, Google Cloud SQL, Azure, DigitalOcean), or self-hosted with cron `pg_dump` + off-site copies. One test restore before launch. |
| Persistent private storage | local disk (`STORAGE_ROOT`) | **Blocker** (configuration) | A persistent volume mounted at `STORAGE_ROOT`, backed up with the DB. |
| Payment | **manual/offline only** (`MANUAL_OFFLINE` provider; an admin confirms receipt; the UI says nothing is charged online) | Owner decision | Launching with manual payments is supported. For online payment, implement `PaymentProvider.createIntent()` in `src/lib/payments/provider.ts` for Paymob, Fawry, Stripe or PayTabs. Add a webhook route that verifies the provider signature and calls the existing `confirmPayment()` / `rejectPayment()`. Prerequisites: merchant account, API keys, webhook secret, sandbox testing, reconciliation process. |
| Video delivery | private disk + range streaming, server-side view accounting, watermark overlay | Not a blocker for a small launch; needed at scale | Implement `StorageProvider` (`src/lib/storage/provider.ts`) for S3/R2 + a CDN with signed URLs, or a video platform (Mux, Cloudflare Stream, Bunny Stream) for HLS transcoding. **DRM (Widevine/FairPlay) is optional** and needs a DRM-capable provider plus license service. None of this exists today; no HLS/DRM is claimed. |
| Transcoding | none | Operational requirement | Until a video platform is added, teachers must upload H.264/AAC MP4. |
| Scheduled jobs | none | Not a blocker | Access checks evaluate expiry live, so correctness never depends on a job. Optional cron (e.g. systemd timer → a small script) to run `syncExpiredSubscriptions` for dashboard status. Parent reports are generated manually by teachers. |
| Email / SMS | none (`notify()` writes in-app notifications only) | **Owner decision: see password recovery** | Add a delivery channel in `notify()` via SES, SendGrid, Mailgun, or an SMS provider (e.g. Twilio, Vonage, a local Egyptian SMS gateway). Needed for any password-reset flow. |
| Password recovery | **does not exist** (no reset or change-password flow for any role) | **Blocker unless the owner accepts manual resets** | Options: (a) email-based reset tokens (needs email above); (b) an admin-initiated reset in `/teacher/accounts` (product decision). Until then, a forgotten password needs a DB-level reset by an operator. |
| Monitoring | `/api/health`, JSON error lines | Recommended before launch | Uptime check on `/api/health` (UptimeRobot, Better Stack, Pingdom); log shipping (Loki, CloudWatch, Datadog); optional error tracking (Sentry) via `onRequestError`. |
| CAPTCHA | none | Optional (mitigated by proxy rate limits) | Cloudflare Turnstile, hCaptcha or reCAPTCHA on `/register`, verified server-side in the register route. Needs a site key and secret. |
| Horizontal scaling | single instance | Not needed at launch | Shared/object storage (above) first; then multiple instances behind the proxy (sessions are JWT, so no sticky sessions are needed). |

---

## 12. Go-live checklist

- [ ] TLS domain and reverse proxy with the §5 body-size and rate limits.
- [ ] Production PostgreSQL; `prisma migrate deploy` → "up to date".
- [ ] `AUTH_SECRET` (random, ≥ 32 chars), `AUTH_TRUST_HOST` or `AUTH_URL`,
      `NEXTAUTH_URL` / `APP_BASE_URL` (https), `STORAGE_ROOT` (persistent,
      mode 700) all set; the server logs "checks passed".
- [ ] Seed run once with `SEED_TEACHER_EMAIL` / `SEED_TEACHER_PASSWORD`.
      No account uses the development default password.
- [ ] Academic-year end set for the current year.
- [ ] Nightly DB + storage backups scheduled, copied off-host, and one
      test restore performed.
- [ ] Uptime monitor on `/api/health`; logs shipped.
- [ ] Owner decision recorded: manual/offline payments at launch (yes/no).
- [ ] Owner decision recorded: password recovery (email reset, admin
      reset, or manual DB reset).
- [ ] Teachers briefed: upload H.264/AAC MP4. Views are counted by the
      server from the bytes it delivers.
- [ ] Smoke tests (§9) pass on the production URL.
