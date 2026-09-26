# Deployment Guide — EduPlat

This guide covers self-hosting EduPlat in production. Every command below
was run during the production-readiness audits (2026-09-25 and 2026-09-26)
against a production build (`next build` + `next start`). Where a step
depends on something the owner must supply (a domain, a certificate, a
managed database, …), it says so.

**No external integration is configured or tested in this repository:**
no payment gateway, video CDN, email, SMS, CAPTCHA or monitoring SaaS.
Payment is manual/offline. Password-reset links are handed over by a
teacher or an operator, not emailed (§6a).

---

## 1. Topology

```
 browser ──https:443──▶ reverse proxy (TLS ends here) ──http──▶ 127.0.0.1:3000 next start ──▶ PostgreSQL 16
                        nginx / Caddy / cloud LB                  (one process)                 │
                        body-size + rate limits                        │                        └─ scheduled pg_dump (owner)
                                                                       └─▶ STORAGE_ROOT (persistent private volume)
```

- **TLS terminates at the reverse proxy.** The app listens on plain HTTP
  and must be bound to loopback or a private network only:
  `next start -H 127.0.0.1`. It must never be reachable directly from
  the internet.
- **One Next.js 16 Node.js process.** It serves pages, APIs and private
  media through access-checked routes.
- **One PostgreSQL 16 database.**
- **One persistent private directory (`STORAGE_ROOT`)** holds lesson
  videos, shorts and attachments. Files are served only through
  `/api/stream/*`, `/api/stream-short/*` and `/api/attachments/*`, never
  as static files.
- **Single instance only, as shipped.** Private files live on local disk.
  Run exactly one app instance unless `STORAGE_ROOT` is on shared storage
  that every instance mounts; §12 covers object storage. The database
  scales independently.

Tested versions:
- Node.js 22.22 (npm 10.9)
- PostgreSQL 16.13
- Next.js 16.3.5
- Prisma 6.19
- Auth.js (next-auth) 5.0.0-beta.32
- nginx 1.24 (the TLS test in §5)

---

## 2. Environment variables

Set these in the process environment. Real environment variables override
`.env`. Never commit real values; `.env.example` holds placeholders only.

The server validates them at startup (§7). In production any error below
**stops the process** (`exit 1`) with a message that names the variable
but never shows its value.

| Variable | Production | Purpose / format |
|---|---|---|
| `NODE_ENV` | set by `next start` | `production`. Enables the strict startup checks and HSTS. |
| `DATABASE_URL` | **required** | `postgresql://USER:PASSWORD@HOST:5432/DBNAME`. The DB user must own the schema because it runs migrations. |
| `AUTH_SECRET` | **required**, ≥ 32 random chars | Signs sessions, video playback tokens and attachment download tokens. Generate with `openssl rand -base64 48`. Changing it signs everyone out and invalidates outstanding links. |
| `AUTH_URL` | **required**, `https://` | The public origin, e.g. `https://edu.example.com`; plain `http` is accepted only for `localhost`. See the list below the table. `NEXTAUTH_URL` is accepted as a legacy alias. |
| `STORAGE_ROOT` | **required**, absolute | The persistent private volume, e.g. `/var/lib/eduplat/storage`. It must be outside the app directory, and it is refused if it points inside `public/`. |
| `APP_BASE_URL` | optional, `https://` | The origin printed in certificate QR codes and reset links. Defaults to `AUTH_URL`; a different origin produces a startup warning. |
| `AUTH_TRUST_HOST` | not needed | Unneeded once `AUTH_URL` is set, and not sufficient without it. |
| `SEED_TEACHER_EMAIL` / `SEED_TEACHER_PASSWORD` | first deploy only | The first teacher/admin account; the password needs at least 12 characters and is never printed. The seed **refuses to run in production without them**. Remove them from the server's environment afterwards; startup warns if they remain. |
| `DEV_OUTBOX_DIR` | never | Development only: where reset links are written instead of being emailed. The outbox refuses to run in production. |
| `PORT` / `-p`, `-H` | optional | Listen port (default 3000) and host. Use `-H 127.0.0.1` behind the proxy. |

What `AUTH_URL` controls:
- Auth.js builds every redirect and callback from it instead of the
  request's `Host` / `X-Forwarded-*` headers.
- Because it is https, Auth.js issues `__Secure-authjs.session-token` and
  `__Host-authjs.csrf-token` cookies with `Secure`, `HttpOnly` and
  `SameSite=Lax`, whatever the proxy forwards.

**Cookies:** there are no other cookies, and nothing is stored in
`localStorage`. Sessions are JWTs (30-day maximum). Each session is still
re-checked against the database on every protected request:
- a blocked account is signed out;
- a password reset or change signs out every existing session;
- sign-out revokes that session server-side.

---

## 3. First deployment (fresh database)

```bash
# 0. Code at the release commit, dependencies installed (dev dependencies
#    too: the seed and the reset-link script use tsx, the build needs TypeScript).
git checkout <release-tag-or-commit>
npm ci

# 1. Database: an empty database owned by the app's DB user.
#    (Self-managed Postgres shown; with managed Postgres create it in the console.)
sudo -u postgres createdb -O eduplat eduplat

# 2. Apply all migrations (21 as of this guide). Idempotent: applies only pending ones.
DATABASE_URL=... npx prisma migrate deploy
DATABASE_URL=... npx prisma migrate status        # → "Database schema is up to date!"

# 3. Seed platform settings + the first teacher/admin account (once).
NODE_ENV=production DATABASE_URL=... \
  SEED_TEACHER_EMAIL=admin@your-domain SEED_TEACHER_PASSWORD='<12+ chars>' \
  npm run db:seed
#    Safe to re-run: settings are upserted and an existing account is left unchanged.
#    No demo/test accounts are created. The development default password
#    exists only when NODE_ENV is not production.

# 4. Build.
npx prisma generate
npm run build

# 5. Private storage volume (see §6).
sudo mkdir -p /var/lib/eduplat/storage
sudo chown <app-user>: /var/lib/eduplat/storage && sudo chmod 700 /var/lib/eduplat/storage

# 6. Start (under systemd, a container runtime, pm2, …), loopback only.
NODE_ENV=production DATABASE_URL=... AUTH_SECRET=... \
  AUTH_URL=https://edu.example.com STORAGE_ROOT=/var/lib/eduplat/storage \
  npm start -- -H 127.0.0.1 -p 3000
```

A healthy start logs `[startup] configuration and private storage checks
passed`, plus one expected warning that no email/SMS provider is
integrated (§6a).

`npm run build` needs no database and no `.env`; every data page is
rendered per request.

**Reproduced end to end (release-candidate gate, 2026-09-26)** in a
fresh `git clone` with no `.env`, its own empty database and its own
storage directory:
1. `npm ci` (478 packages).
2. 21 migrations in 1.6 s, "up to date".
3. Build in 28 s.
4. The production seed refused without credentials (0 users). With
   explicit credentials it created exactly 1 `TEACHER_ADMIN` and no demo
   or development accounts, and the password never appeared in output.
5. 8 unsafe configurations each exited 1 with the right message:
   - `AUTH_SECRET` missing or weak;
   - `AUTH_URL` invalid or plain http;
   - `DATABASE_URL` missing;
   - `STORAGE_ROOT` missing, under `public/`, or unwritable.
6. A healthy start; then the full teacher → student → parent journey
   passed 12/12: manual payment, playback, PDF, experiment, quiz,
   certificate, parent report and refund.
7. Files were stored with mode 600 in directories with mode 700, and no
   secret appeared in the log.
8. `pg_dump` + storage tar → restore into a new database and a new
   directory → row counts and file checksums identical.
9. Restart on the restored copy; the seeded teacher logs in, the
   attachment download is byte-identical, and a guest is still refused
   (401).

**After the first login:**
- Set the academic-year end under platform settings. Checkout refuses to
  sell a subscription once the configured end has passed; the seed
  default is 31 July of the following year.
- Change the seeded password under «تغيير كلمة المرور» if it was shared
  with anyone.

---

## 4. Upgrading an existing installation

```bash
# 1. Pre-migration backup — REQUIRED (§8). Keep it until the release is confirmed good.
pg_dump "$DATABASE_URL" -Fc -f /backups/eduplat_pre_<release>.dump
tar -C /var/lib/eduplat -czf /backups/eduplat_storage_pre_<release>.tgz storage
# 2. Stop the app (or drain it), deploy the new code, build.
npm ci && npx prisma generate && npm run build
# 3. Migrate, then check.
npx prisma migrate deploy && npx prisma migrate status
# 4. Start and run the smoke tests (§9).
```

**This release (2026-09-26)** adds two purely additive migrations:
- `20260927000000_password_reset`: `User.sessionVersion` and
  `passwordChangedAt`, plus the `PasswordResetToken` and
  `PasswordResetRequest` tables;
- `20260927010000_revoked_sessions`: the `RevokedSession` table.

Existing sessions stay valid: tokens without a version count as version
0, and they receive a session id on their next refresh.

Verified earlier (2026-09-25) on a copy of the pre-release schema. It
held 2,002 users, 5,000 entitlements, 20,000 watch sessions, 1,500
referral rewards, 3,000 experiment attempts and 300 certificates.
- 6 pending migrations applied in 1.85 s, and every row count was
  identical before and after.

### If a migration fails

Migrations that could lose or orphan data first run a check and **abort
before changing anything**. The error names the problem, e.g.
`Orphaned user references found (column=rows): Course.teacherId=1 … nothing was changed.`

Recovery, tested end-to-end:

```bash
npx prisma migrate status            # shows which migration failed
# Fix the data the message names, e.g. re-point the orphaned rows:
psql "$DATABASE_URL" -c 'UPDATE "Course" SET "teacherId"=<existing teacher id> WHERE "teacherId"=<missing id>'
npx prisma migrate resolve --rolled-back <failed_migration_name>
npx prisma migrate deploy            # re-applies it and continues
```

Never run `prisma migrate dev` or `prisma db push` against production.

---

## 5. Reverse proxy and TLS (required)

The app sets its own security headers on every response:
- `X-Frame-Options: DENY`;
- `Content-Security-Policy` with `frame-ancestors 'none'`, `base-uri`,
  `form-action` and `object-src 'none'`;
- `nosniff`, `Referrer-Policy` and `Permissions-Policy`;
- `Strict-Transport-Security` (1 year) in production;
- no `X-Powered-By`.

The proxy must provide TLS and the limits below. The app's Server Action
body limit is 500 MB **globally** (the video upload needs it), so
restrict body size per path at the proxy.

This exact configuration was run in front of the production build during
the 2026-09-26 audit. The test used a self-signed certificate on :8443,
with port 8443 in the `Host` header because of the non-standard port.
Use it with your domain and certificate:

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=reset:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api:10m   rate=20r/s;
limit_req_status 429;

server {                                   # HTTP → HTTPS
  listen 80;
  server_name edu.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name edu.example.com;
  ssl_certificate     /etc/letsencrypt/live/edu.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/edu.example.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  proxy_set_header Host              $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-Host  $host;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Real-IP         $remote_addr;
  proxy_read_timeout 300s;                 # long video range responses

  client_max_body_size 30m;                # default: attachments ≤ 25 MB

  location /teacher/courses/ { client_max_body_size 510m; proxy_request_buffering off; proxy_pass http://127.0.0.1:3000; }  # lesson video upload (≤ 500 MB)
  location = /teacher/shorts { client_max_body_size 110m; proxy_request_buffering off; proxy_pass http://127.0.0.1:3000; }  # shorts upload (≤ 100 MB)
  location = /api/auth/callback/credentials { limit_req zone=login burst=10 nodelay; proxy_pass http://127.0.0.1:3000; }
  location = /api/auth/register            { limit_req zone=login burst=5 nodelay;  proxy_pass http://127.0.0.1:3000; }
  location = /forgot-password               { limit_req zone=reset burst=5 nodelay;  proxy_pass http://127.0.0.1:3000; }
  location = /reset-password                { limit_req zone=reset burst=10 nodelay; proxy_pass http://127.0.0.1:3000; }
  location /api/ { limit_req zone=api burst=60 nodelay; proxy_pass http://127.0.0.1:3000; }
  location /     { proxy_pass http://127.0.0.1:3000; }
}
```

**Verified through this proxy (2026-09-26), 8/8:**
- Login over https set only `__Secure-authjs.session-token` and
  `__Host-authjs.csrf-token`, both `Secure`, `HttpOnly` and
  `SameSite=Lax`; no unprefixed auth cookie.
- HTTP was redirected to HTTPS with a 301, and HSTS was present on
  responses.
- A server action (forgot-password) passed Next's origin check through
  the proxy.
- A spoofed `Host` / `X-Forwarded-Host: evil.example` still redirected to
  `https://<AUTH_URL>/login`, and the auth URLs never used the spoofed
  host.
- `/storage/videos/<key>`, `/videos/<key>`, `/<key>` and a `../`
  traversal path all returned 404; `/api/stream/<id>` without or with a
  forged token returned 401.
- `/api/health` returned only `{"status":"ok"}`.
- Of 16 rapid sign-in POSTs, the first 10 passed and the rest got 429.
- A 40 MB POST to `/student` got 413; the same body to `/teacher/shorts`
  passed the proxy (the app then required a session).

**Rate limiting inside the app** (independent of the proxy):
- Login: 5 failures per email per 15 minutes (configurable).
- Wrong current passwords on the change-password page count toward the
  same lockout.
- Reset requests: 3 per email per 15 minutes, counted identically for
  addresses with and without an account.

Registration, heartbeats and playback-URL issuance rely on the proxy
limits above.

---

## 6. Private storage

**Setup:**
- A dedicated persistent volume (a disk, an EBS/PD volume, or a
  container volume) mounted outside the app directory, e.g.
  `/var/lib/eduplat/storage`.
- Owned by the app's OS user, mode `700`.
- Set as `STORAGE_ROOT`.
- Never inside `public/` (refused at startup), never served by the
  proxy, and never on a public bucket.

**Layout and permissions:**
- `$STORAGE_ROOT/videos/<uuid>.<mp4|mov|webm>` holds lesson videos and
  shorts; `$STORAGE_ROOT/attachments/<uuid>.<ext>` holds attachments.
- Names are random. The uploaded name is kept only in the database, and
  the extension comes from the **detected content**, not the client's
  filename.
- New directories are created with mode 700 and files with 600.
- Storage keys are bare file names; `..`, `/`, `\` and NUL are refused.

**What is enforced on upload:**
- **Videos and shorts:** the declared type must be MP4, WebM or MOV, and
  the bytes must start with an ISO-BMFF `ftyp` box or a WebM EBML header
  that matches the declared type. Limits are 500 MB for videos and
  100 MB for shorts.
- **Attachments:** magic bytes are checked for PDF, images, DOCX and
  PPTX, up to 25 MB. Downloads are served as attachments with `nosniff`
  and a sandbox CSP.

**Replacing and deleting files:**
- Replacing a lesson video points the database at the new file first and
  deletes the old file afterwards.
- A failed upload removes its new file.
- A replaced video keeps its publication status; replacing a draft does
  not publish it.
- Deleting an attachment deletes its file.
- Deleting a lesson or short leaves the file unreferenced (still private,
  never served).

**Access on every read:**
- **Video:** the signed token is bound to the student, the video and a
  watch session. It expires after 4 hours and refuses other accounts
  (403). The entitlement and publication status are re-checked on every
  range request.
- **Attachments:** the token is bound to student + attachment and lasts
  10 minutes. The entitlement is re-checked at download time.
- **Startup:** the directories are created if missing, and a write probe
  must succeed within 5 s, or the process exits in production.

**Verified:**
- Files uploaded through the UI were served byte-identical after a
  restart.
- Anonymous requests and direct paths were refused.
- A fresh short uploaded through the UI streamed to a guest (206).

**Video format:** there is no transcoding. Teachers must upload
browser-playable MP4 (H.264 + AAC, `faststart`). Range responses follow
RFC 9110: a range past the end is clamped, and suffix ranges return the
last bytes. Bandwidth passes through Node, which is fine for a small
launch (§12).

**Back up this directory together with the database** (§8).

### 6a. Password recovery in production (no email provider)

No email or SMS provider is integrated, so self-service reset links are
**not delivered** in production:
- `/forgot-password` says so honestly and asks the user to contact the
  teacher or admin.
- Requests are still accepted, rate-limited and answered identically
  whether or not the account exists. The account lookup runs after the
  response is sent.

Working production paths:
1. **Students and parents:** the teacher opens `/teacher/accounts` and
   clicks «رابط إعادة تعيين كلمة المرور». The one-time link is shown
   **once**:
   - it is valid for 4 hours and single-use;
   - issuing a new link cancels the previous one;
   - it is audit-logged (`ISSUE_PASSWORD_RESET_LINK`).

   Hand it to the account owner through a trusted channel.
2. **The teacher/admin account:** an operator with shell access runs
   `npm run password:reset-link -- teacher@your-domain`. The link is
   printed to that terminal only and audit-logged.
3. **Any signed-in user:** «تغيير كلمة المرور» (`/account/password`)
   needs the current password.

After any reset or change every existing session of that account ends,
including on other devices.

Security properties:
- Only a SHA-256 hash of each token is stored.
- The token travels in the URL fragment, so it never reaches proxy
  access logs or `Referer` headers.
- Nothing logs tokens, passwords or emails.

To add emailed links later, implement a delivery in
`src/lib/business/password-reset-delivery.ts` (SES, SendGrid, Mailgun,
an SMS gateway, …). It needs the provider's API key, a verified sender
domain (SPF/DKIM) and `APP_BASE_URL`.

---

## 7. Startup behavior and logs

At startup `src/instrumentation.ts` → `src/lib/startup.ts` checks:
- `DATABASE_URL` is a postgres URL;
- `AUTH_SECRET` is at least 32 characters and not the placeholder;
- `AUTH_URL` (or `NEXTAUTH_URL`) is set and https (except localhost);
- `APP_BASE_URL`, if set, is https and matches `AUTH_URL`, otherwise a
  warning;
- `STORAGE_ROOT` is set, absolute, and not under `public/`;
- then, only if all of that is valid, private storage is writable.

**Verified (2026-09-26):** each of these makes `next start` exit 1:
- no `AUTH_URL`, even with `AUTH_TRUST_HOST=true`;
- `AUTH_URL=http://edu.example.com`;
- no `STORAGE_ROOT`;
- `STORAGE_ROOT` under `public/`.

A complete configuration started and reported healthy. Earlier checks
also covered a weak secret, an unwritable directory (`ENOTDIR`) and a
hanging mount (`TIMEOUT`). No secret value appeared in any log.

Logs go to stdout/stderr:
- Server errors are one JSON line each: method, path **without the query
  string**, route, digest and message. They never include headers,
  cookies, tokens or passwords.
- `[startup] …` lines report the checks.
- `[password-reset] … no email/SMS provider is configured` means a reset
  was requested. The line carries no email or token.
- `[stream] delivery accounting failed` appears only on a database error.

Health check: `GET /api/health` returns `200 {"status":"ok"}`, or
`503 {"status":"unavailable"}` if the database is unreachable. It never
includes details. Point the proxy/LB health check and an uptime monitor
at it.

---

## 8. Database backup and restore

Nothing in this repository schedules backups; the owner or host must.

**What:**
1. The database, with `pg_dump -Fc`.
2. `STORAGE_ROOT`.

Take both together, because a DB restore without the matching files
gives 404s on playback and downloads.

**How often:**
- Nightly at minimum.
- **Always immediately before a migration or upgrade** (§4 step 1).
- With managed Postgres, also enable point-in-time recovery (PITR).

**Retention (recommended):**
- 7 daily, 4 weekly and 3 monthly backups;
- pre-upgrade dumps until the next release is confirmed good;
- copies kept off-host and encrypted (e.g. object storage with
  server-side encryption and restricted credentials).

```bash
# Backup (example: cron at 02:30 as the app user)
pg_dump "$DATABASE_URL" -Fc -f /backups/eduplat_$(date +%F).dump
tar -C /var/lib/eduplat -czf /backups/eduplat_storage_$(date +%F).tgz storage

# Restore into a NEW database first (never over the live one)
createdb -O eduplat eduplat_restore
pg_restore --no-owner -d "postgresql://…/eduplat_restore" /backups/eduplat_<date>.dump
DATABASE_URL=postgresql://…/eduplat_restore npx prisma migrate status   # → up to date
tar -C /var/lib/eduplat -xzf /backups/eduplat_storage_<date>.tgz        # files
```

**Restore verification** (do this at least once before launch, then
periodically):
1. `migrate status` reports "up to date".
2. Row counts match the source, e.g.

   ```sql
   SELECT 'users',count(*) FROM "User" UNION ALL SELECT 'courses',count(*) FROM "Course"
   UNION ALL SELECT 'entitlements',count(*) FROM "Entitlement" UNION ALL SELECT 'payments',count(*) FROM "Payment"
   UNION ALL SELECT 'attachments',count(*) FROM "Attachment";
   ```
3. Start the app against the restored DB and run the §9 smoke tests.
   Playback and an attachment download confirm the files match.
4. Switch `DATABASE_URL` (or rename the databases) and restart.

**Verified during the audits:**
- The development DB was restored with identical counts: 181 users, 41
  courses, 59 lessons, 7 entitlements, 76 watch sessions, 16 quiz
  attempts, 4 certificates, 3 attachments and 39 audit rows.
- `migrate status` reported up to date.
- The populated upgrade dump also restored identically.

---

## 9. Smoke tests after every deploy

Deterministic checklist. The automated version (19 steps) was run against
the production build on 2026-09-26 and **passed 19/19**; the result is
shown for each item.

**Quick HTTP checks (no account needed):**

```bash
BASE=https://edu.example.com
curl -fsS $BASE/api/health                                                          # {"status":"ok"}
for p in / /login /register /shorts /forgot-password; do curl -s -o /dev/null -w "$p %{http_code}\n" $BASE$p; done   # 200
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $BASE/teacher               # 307 → $BASE/login…
curl -s -o /dev/null -w "%{http_code}\n" $BASE/nonexistent                          # 404
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/notifications                    # 401
curl -sI $BASE/login | grep -iE "x-frame-options|content-security-policy|strict-transport"   # present
curl -s -o /dev/null -w "%{http_code}\n" http://edu.example.com/                   # 301 → https
```

**Guest:**
- Homepage, `/shorts` and a public short stream (206), and a public
  teacher profile, all RTL ✔
- Certificate verification: a valid code is confirmed and an unknown code
  is not ✔
- An unknown URL gives the Arabic 404 ✔
- An action that fails shows the Arabic error page ✔

**Student** (use a test student account):
- Login; the subscription page shows «الدفع يدوي خارج المنصة» ✔
- An entitled lesson plays (signed URL, 206) ✔
- A non-entitled lesson is refused (`NOT_ENTITLED`) ✔
- An unpublished lesson is refused even to entitled students
  (`CONTENT_UNAVAILABLE`) ✔
- Archived content stays available to entitled students only ✔
- At the view limit a new playback is refused (`VIEW_LIMIT_REACHED`) ✔
- The quiz page and experiment page load ✔
- The attachment downloads via the lesson-page link; a bare URL gives
  401 ✔
- A study-time heartbeat is accepted ✔
- Logout ends the session, and the old cookie is refused afterwards ✔

**Teacher:**
- Login; archive → unpublish → publish on a lesson takes effect for
  students immediately ✔
- Accounts (block/unblock), reports, certificates, support, payments and
  analytics pages ✔
- Upload a short ✔

**Parent:**
- Login; the linked student's analytics show study time and progress,
  and their report opens ✔
- Another student's analytics and reports are refused ✔

**Security:**
- Anonymous access to `/student` → 307; to APIs → 401 ✔
- A student opening `/teacher`, `/parent` → 307 ✔
- A copied signed URL used by another account → 403; expired → 401;
  tampered → 401 ✔
- A blocked user's live session ends and login is refused; unblocking
  restores it ✔
- IDOR: another student's certificate → 404, a refunded lesson's PDF →
  401, a parent report for an unlinked child → 307 ✔
- 8 parallel playback URLs → 8 distinct watch sessions; 5 parallel
  checkouts → 1 subscription with 1 `PENDING` `MANUAL_OFFLINE` payment ✔
- Health and security headers present; no `X-Powered-By` ✔

**Manual-payment check by hand:** the admin confirms the test student's
pending payment in `/teacher/payments`. The student can then play the
lesson.

---

## 10. Rollback

- **App-only rollback** (no new migrations in the release): redeploy the
  previous build and restart.
- **This release (2026-09-26)**: its two migrations are additive, so the
  previous build runs against the migrated database unchanged. The only
  effect is that sessions revoked by sign-out, reset or change are no
  longer refused by the old code until they expire. Roll back the app
  only; there is no need to restore the database.
- **A release whose migrations changed data**: migrations are
  forward-only. Stop the app, restore the pre-upgrade dump (§4 step 1)
  into a new database, switch `DATABASE_URL`, and redeploy the previous
  build. Data written after the dump is lost, so decide quickly or fix
  forward.
- Keep `AUTH_SECRET` unchanged during a rollback; changing it signs
  everyone out.

---

## 11. Online payment gateway — what connecting one requires

Payment today is **manual/offline**:
1. Checkout creates a `PENDING` `MANUAL_OFFLINE` payment, and the
   student is told nothing is charged online.
2. A teacher confirms receipt in `/teacher/payments`, and only then is
   access granted.
3. Confirm, reject and refund are teacher-only atomic transitions, each
   with an audit row.

A student cannot change a payment's status. Duplicate and simultaneous
checkouts are refused, and so is a checkout after the academic year ends.
**No provider is selected.** Connecting one (Paymob, Fawry, Stripe,
PayTabs, … — the owner's choice) requires:

- **Code:**
  - Implement `PaymentProvider.createIntent()` in
    `src/lib/payments/provider.ts` for that provider, returning its
    checkout/redirect data, and route non-zero amounts to it in
    `getActivePaymentProvider()`.
  - Add a webhook route that verifies the provider's signature, is
    idempotent (keyed by `providerRef`), checks the amount and currency
    against the `Payment` row, and then calls the existing
    `confirmPayment()` / `rejectPayment()`.
  - Refunds call the provider's refund API before `refundPayment()`.
- **Owner:** a merchant account, API keys and a webhook secret (as
  environment variables, never committed), a sandbox test run for
  success, failure, duplicate webhook and refund, and a reconciliation
  routine against provider reports.

---

## 12. External integrations — status and options

Nothing here is configured or tested with real credentials. "Blocker"
means the platform should not go live without it.

| Area | Status | Launch? | Path / prerequisites |
|---|---|---|---|
| Domain, TLS certificate, reverse proxy | config tested with nginx + self-signed TLS (§5) | **Blocker (owner)** | Domain, certificate (e.g. Let's Encrypt), and the proxy in §5. |
| Production PostgreSQL + scheduled backups | procedure tested (§8) | **Blocker (owner)** | Managed Postgres with PITR (AWS RDS, Google Cloud SQL, Azure, DigitalOcean, …), or self-hosted with cron `pg_dump` + off-host copies. One test restore before launch. |
| Persistent private storage | local disk, `STORAGE_ROOT` required | **Blocker (owner, configuration)** | A persistent volume (§6) included in backups. |
| Payment | manual/offline, verified | Owner decision | Launching with manual payments is supported; §11 for online. |
| Email / SMS | none; in-app notifications only | Not a blocker (manual reset paths exist, §6a) | SES, SendGrid, Mailgun, or an SMS gateway via `password-reset-delivery.ts` / `notify()`. |
| Video delivery / HLS / DRM / CDN | private disk + range streaming, server-side view accounting | Not for a small launch; needed at scale | `StorageProvider` for S3/R2 + a CDN with signed URLs, or a video platform (Mux, Cloudflare Stream, Bunny Stream). DRM optional. None exists today. |
| Scheduled jobs | none | Not a blocker | Access checks evaluate expiry live. Optional cron for `syncExpiredSubscriptions`. |
| Monitoring | `/api/health`, JSON error lines | Recommended | An uptime check on `/api/health`, log shipping, optional error tracking via `onRequestError`. |
| CAPTCHA | none | Optional | Turnstile, hCaptcha or reCAPTCHA on `/register` and `/forgot-password`; needs a site key and secret. |
| Horizontal scaling | single instance | Not needed at launch | Shared/object storage first; sessions are JWT + DB checks, so no sticky sessions are needed. |

---

## 13. Go-live checklist

Owner / infrastructure:
- [ ] Domain + TLS certificate; reverse proxy with the §5 config
      (HTTP→HTTPS, body sizes, rate limits); app bound to `127.0.0.1`.
- [ ] Production PostgreSQL; `prisma migrate deploy` → "up to date".
- [ ] Persistent `STORAGE_ROOT` volume, mode 700, outside the app
      directory.
- [ ] Nightly DB + storage backups scheduled, copied off-host and
      encrypted, retention set, and **one test restore performed** (§8).
- [ ] Uptime monitor on `/api/health`; logs shipped somewhere searchable.

Configuration:
- [ ] `AUTH_SECRET` (random, ≥ 32 characters) and
      `AUTH_URL=https://<domain>`, with `APP_BASE_URL` equal or unset.
- [ ] Startup logs "checks passed". The only warning is the email/SMS
      notice.
- [ ] Seed run once with `SEED_TEACHER_EMAIL` / `SEED_TEACHER_PASSWORD`,
      then both removed from the environment.
- [ ] No development `.env`, `.dev-outbox/` or test accounts on the
      server.
- [ ] Academic-year end set.

Decisions:
- [ ] Launch with manual/offline payments: yes/no (§11).
- [ ] Password-reset procedure agreed: teacher-issued links for students
      and parents, the operator script for the teacher (§6a), or add an
      email provider.
- [ ] Teachers briefed: upload H.264/AAC MP4; views are counted by the
      server.

Verification:
- [ ] §9 smoke tests pass on the production URL, including the TLS
      checks in §5.
