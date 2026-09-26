# Production Infrastructure Assessment & Deployment Plan — EduPlat

Assessment date: 2026-09-26, at release-candidate commit `0507472`
(branch `claude/fervent-cerf-i5mcqz`).

This is a **plan**. Nothing described here has been deployed, and no
provider has been chosen. Every number is marked by its origin:
- **measured**: run in this repository's test environment against the
  production build;
- **from the code**: read from the source;
- **estimate**: an assumption, with its reasoning stated.

DEPLOYMENT.md remains the operational runbook. This document sizes and
designs the environment it runs in.

> **Read §0 first.** The assessment found one application-side defect
> that blocks real video uploads. It is not fixed in this round, which
> was planning only; the fix is identified and was verified in a scratch
> copy.

---

## 0. Findings of this assessment that change the release status

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| INF-1 | **Launch blocker (application)** | **Every video, short or attachment upload larger than 10 MB fails in production.** Next.js 16 buffers the body of every request that passes through `proxy.ts` and caps that buffer at 10 MB by default (`experimental.proxyClientMaxBodySize`). `proxy.ts` matches `/teacher/*`, where the upload Server Actions post, so the action receives a truncated form and throws `Unexpected end of form`. The earlier test suites used fixtures under 1 MB, which is why no suite caught it. | **measured:** a 300 MB upload through the real teacher UI logged `Request body exceeded 10MB for /teacher/courses/…` + `Unexpected end of form`; the video was not replaced. | **Not fixed in this round** (planning only, no application changes). The fix below was **verified in a throwaway clone**: the same 300 MB upload then took 8.1 s, stored 300 MB, and the old file was removed. It must be applied, regression-tested and released before launch. |
| INF-2 | Security (logging) | The documented nginx config used the default access-log format, which records the full request line — including the signed `?token=` of every video/attachment URL (valid 4 h / 10 min). | **measured:** a real signed playback token appeared in `access.log`; with the log format in §M it no longer did, and the TLS checks still passed 8/8. | Fixed in DEPLOYMENT.md §5 (documentation/configuration only). |
| INF-3 | Operational | Node's HTTP server ends any request that takes longer than **300 s** (`requestTimeout`; Next.js does not change it). With `proxy_request_buffering off` (the previous config), nginx streams a slow upload straight to Node, so a large video on a slow uplink is cut off. | **measured:** a 20 MB upload at 50 KB/s sent straight to Node got **HTTP 408 after ≈ 300 s** (16.6 of 20 MB received). The same upload through nginx with `proxy_request_buffering on` took 410 s, and the app answered normally (no 408). | Fixed in DEPLOYMENT.md §5 (configuration only, verified): nginx receives the whole upload body first (`proxy_request_buffering on`), then forwards it over loopback in seconds. |
| INF-4 | Operational | A file of exactly 500 MiB is refused (HTTP 413): multipart overhead pushes the body over the 500 MB Server Action limit. | **measured:** a 500 MiB upload → `Body exceeded 500mb limit`. | Documented: the practical maximum per video is **about 480 MB**. |

**INF-1 fix (verified in a scratch clone, not applied):** in
`src/proxy.ts`, exclude Server Action POSTs from the proxy matcher. The
proxy never needs to see a Server Action body, and every Server Action
already authenticates itself (all 89 were checked in the release gate).
Page loads and client-side navigations still pass through the proxy's
live session check.

```ts
export const config = {
  matcher: [
    { source: "/teacher/:path*", missing: [{ type: "header", key: "next-action" }] },
    { source: "/parent/:path*",  missing: [{ type: "header", key: "next-action" }] },
    { source: "/student/:path*", missing: [{ type: "header", key: "next-action" }] },
    { source: "/account/:path*", missing: [{ type: "header", key: "next-action" }] },
  ],
};
```

Rejected alternative: raising `experimental.proxyClientMaxBodySize` to
about 510 MB. It would make the proxy hold a second full in-memory copy
of every upload.

The fix needs a regression test that uploads a file larger than 10 MB
through the real route, plus a re-run of the full suites. Until it
ships, **the release status is NOT READY**: teachers cannot upload real
lesson videos.

---

## A. Current application deployment requirements

| Item | Value | Source |
|---|---|---|
| Framework | Next.js **16.3.5** (App Router), React 19.2.8 | `package.json` |
| Node.js | **22 LTS** (tested: 22.22.2). Next requires ≥ 20.9; nothing is pinned — no `engines` field and no `.nvmrc`, so pin 22.x on the server. | `node_modules/next/package.json` |
| Package manager | **npm** (`package-lock.json`; `npm ci` verified on a clean clone: 478 packages) | repo |
| Build command | `npx prisma generate && npm run build` (`next build`). Needs **no database and no `.env`** (verified). | release gate |
| Start command | `npm start -- -H 127.0.0.1 -p 3000` (`next start`) | DEPLOYMENT.md |
| Migrations | `npx prisma migrate deploy` (21 migrations; 1.6 s on an empty DB) | `prisma/migrations` |
| First admin | `npm run db:seed` with `NODE_ENV=production`, `SEED_TEACHER_EMAIL`, `SEED_TEACHER_PASSWORD` | `prisma/seed.ts` |
| ORM | Prisma **6.19.3** (CLI + client). The CLI, `tsx` and TypeScript are dev dependencies, so production needs `npm ci` **with** dev dependencies. | `package.json` |
| Database | **PostgreSQL 16** (tested 16.13). Uses advisory locks (`pg_advisory_xact_lock`), `INTEGER[]` columns, enums and `hashtext()`, all standard PostgreSQL. No extensions required. | migrations, code |
| OS / runtime | Linux x86-64 or arm64 with systemd (glibc; Prisma ships native engines for both). Tested on Ubuntu 24.04. | measured env |
| Ports | App: **3000/tcp on 127.0.0.1 only**. Nginx: 80 + 443 public. PostgreSQL: 5432 local or private network only. | DEPLOYMENT.md |
| Filesystem | App directory (code + `node_modules` ≈ 0.9 GB + `.next` 125 MB after a cold build); `STORAGE_ROOT` (persistent, private); backup staging directory | measured |
| Permissions | App runs as a dedicated non-root user that owns `STORAGE_ROOT` (mode 700; files 600, created by the app). The DB user owns the schema (it runs migrations). | `src/lib/storage/provider.ts` |
| Background processes | **None required.** No cron, queue or worker: expiry is evaluated live and parent reports are generated on demand. Only the Node process, nginx and PostgreSQL run. | from the code |
| Instances | **Exactly one app instance.** Files live on local disk, so a second instance would not see the first one's uploads unless both mount the same storage. Everything else (JWT sessions + DB checks, advisory locks) already works across instances. | from the code |

**Is one instance enough?** Yes, for a small launch. Measured on 4 vCPU:
- one Node process served full-file video at **≈ 300 MB/s (≈ 2.4
  Gbit/s)** to 10 and to 50 concurrent streams on loopback, using about
  one CPU core;
- idle memory is 228 MB.

A single instance reaches the server's network link long before its own
limits (§E).

## B. Minimum viable server (one machine, everything on it)

| Resource | Minimum | Reasoning |
|---|---|---|
| CPU | **2 vCPU** | Streaming saturates ≈ 1 core only at multi-Gbit rates (measured). bcrypt (cost 12) costs ≈ 0.25 s CPU per login. A cold build used 2.3 cores for 37 s (measured). |
| RAM | **4 GB + 2 GB swap** | OS ≈ 0.4 GB + PostgreSQL ≈ 0.5–1 GB + Node idle 0.23 GB + **one ≈ 450 MB upload peaks at 1.6 GB** (measured) + nginx/page cache. A cold build peaks at 1.44 GB (measured), so on 4 GB build while the app is stopped, or build elsewhere. 2 GB is **not** enough: one large upload plus PostgreSQL would exhaust it. |
| OS | Ubuntu 24.04 LTS or Debian 12 (x86-64) | Tested platform |
| System disk | 25 GB SSD | OS + app (≈ 1.1 GB) + PostgreSQL (< 1 GB in year 1) + logs + nginx upload buffer (up to ≈ 0.5 GB per concurrent upload, INF-3) |
| Storage (`STORAGE_ROOT`) | Separate volume sized from §D, at least 50 GB to start | Videos dominate |
| Storage type | Block storage / local SSD with a POSIX filesystem (ext4/xfs) | Range reads; the app writes files with mode 600 |
| PostgreSQL | Same machine, 0.5–1 GB RAM share (`shared_buffers` ≈ 256 MB), `max_connections` 100 (default) | Dev DB: 295 users = 13 MB. The app uses one Prisma pool (default size = CPUs × 2 + 1) |
| Network | 100 Mbit/s port minimum; know the monthly transfer quota | §E |

## C. Recommended initial production

| Resource | Recommended | Reasoning |
|---|---|---|
| CPU | **4 vCPU** | Headroom for build on the box, bcrypt bursts at class start, TLS, and PostgreSQL. |
| RAM | **8 GB** (+ 2 GB swap) | Two concurrent 450 MB uploads (≈ 3.2 GB) + PostgreSQL 1–2 GB + page cache for frequently watched videos. |
| OS | Ubuntu 24.04 LTS | Tested |
| System disk | 40–80 GB SSD | OS, app, PostgreSQL data, logs, nginx upload buffer, local backup staging |
| Application/video storage | Separate attached volume, **≥ 100 GB** to start, resizable (§D) | Survives server rebuild; can be detached and re-attached |
| PostgreSQL | Same machine at launch (1–2 GB RAM, SSD). Or a small managed PostgreSQL instance (1–2 vCPU, 2 GB RAM, 10–20 GB storage, automated backups + PITR), which removes DB backup operations from the owner. | Both are supported; the app only needs `DATABASE_URL`. |
| Network | 1 Gbit/s port; monthly transfer quota sized from §E | Video egress is the dominant cost driver |

## D. Storage calculation

**How files are stored (from the code):**
- Location: `$STORAGE_ROOT/videos/<uuid>.<mp4|mov|webm>` for lesson
  videos and shorts, and `$STORAGE_ROOT/attachments/<uuid>.<ext>` for
  attachments.
- Names are random UUIDs. The extension comes from the detected content,
  and the original name is kept only in the database.
- **One copy per upload.** There is no transcoding, no thumbnails and no
  derivative files. Report PDFs are produced by the browser's print, not
  stored on the server.
- **Replacing a video** writes the new file, repoints the row, then
  deletes the old file (**measured:** old file removed).
- **Deleting an attachment** deletes its file.
- Lessons, videos, courses and shorts **cannot be deleted** in the UI,
  only archived or unpublished, so their files stay for the platform's
  lifetime. That is growth to plan for, not a leak.
- A failed upload removes its partial file. Orphaned files can only
  appear if the process is killed mid-upload (rare).
- **Temporary space:** the app keeps uploads in memory, not temp files.
  With `proxy_request_buffering on` (INF-3), nginx writes each upload
  body to its client-body temp directory first: up to ≈ 510 MB per
  concurrent upload on the **system disk**.
- **Limits (from the code):** video ≤ 500 MB, but ≈ 480 MB in practice
  (INF-4); short ≤ 100 MB; attachment ≤ 25 MB.

**Per-file size estimates** (a video file's size is bitrate × duration):
- A lesson video at 720p H.264 (1.5–3 Mbit/s) is 11–22 MB per minute,
  so a 10–25 min lesson is **≈ 110–480 MB**. Planning range:
  **150–450 MB per video**.
- 1080p (4–6 Mbit/s) exceeds 480 MB after about 12–16 min. Longer 1080p
  lessons must be re-encoded smaller or split.
- Attachments: 0.5–5 MB each; plan 3 per lesson.
- Shorts: 5–50 MB.

**Capacity formula:**

```
storage_needed = Σ videos (count × avg size)
               + Σ attachments (count × avg size)
               + shorts (count × avg size)
               + 0 generated files                (none are stored)
               × 1.3 safety margin                (replacements in flight, growth before resize, filesystem overhead)

backup_space   = DB dumps (small) + storage backup
               ≈ 1 × storage (incremental/deduplicating backup of immutable files)
               + DB_dump_size × retained dumps
```

| Library | Videos (150–450 MB) | Attachments (3/lesson × 0.5–5 MB) | With 30 % margin | Suggested volume |
|---|---|---|---|---|
| 100 videos | 15–45 GB | 0.15–1.5 GB | **20–60 GB** | 100 GB |
| 500 videos | 75–225 GB | 0.75–7.5 GB | **100–300 GB** | 300 GB, resizable |
| 1,000 videos | 150–450 GB | 1.5–15 GB | **200–600 GB** | 600 GB+, or object storage (§Q) |

**Monthly growth** = videos uploaded that month × 150–450 MB (+ ≈ 1 %
for attachments). Example: 40 new lessons per month adds ≈ 6–18 GB per
month, plus the same again in backup storage.

## E. Bandwidth calculation

**Currently implemented:** the Node process reads each video from
`STORAGE_ROOT` and streams it over HTTP range requests through nginx.
Every byte a student watches leaves **this server's network interface**.
There is no CDN, no HLS/DASH, no transcoding and no DRM.

Per concurrent viewer, the rate is the video's bitrate: 1.5–3 Mbit/s for
720p, 4–6 Mbit/s for 1080p. Browsers also buffer ahead, so short bursts
run higher.

| Concurrent viewers | at 1.5 Mbit/s | at 3 Mbit/s | at 5 Mbit/s (1080p) | Fits a 100 Mbit/s port? | Fits a 1 Gbit/s port? |
|---|---|---|---|---|---|
| 10 | 15 Mbit/s | 30 Mbit/s | 50 Mbit/s | yes | yes |
| 50 | 75 Mbit/s | 150 Mbit/s | 250 Mbit/s | only at ≤ 1.5 Mbit/s | yes |
| 100 | 150 Mbit/s | 300 Mbit/s | 500 Mbit/s | **no** | yes (≈ 30–50 % used) |

- **App-side limit (measured):** ≈ 2.4 Gbit/s on one core over
  loopback, so the application is not the bottleneck up to ≈ 1 Gbit/s.
- **Monthly egress:** active students × hours watched per month ×
  0.7–1.4 GB per hour (720p). Example: 200 students × 15 h ≈ 2.1–4.2 TB
  per month. Check the host's included transfer and overage policy.
- **A CDN, object storage or video service becomes necessary** when
  concurrent viewers regularly exceed ≈ 60–70 % of the port, monthly
  egress exceeds the plan's quota, or viewers are far from the server
  (§Q). These are **FUTURE SCALING OPTIONS, not implemented**; the
  `StorageProvider` seam is where they plug in.

## F. Production architecture (initial)

```
                         Internet
                            │
                  DNS: edu.example.com  (A → server IPv4, AAAA → IPv6 if used)
                            │
                ┌───────────▼───────────── one server ──────────────────────────────┐
                │  nginx  :80  (public)  → 301 to https                              │
                │  nginx  :443 (public)  TLS termination, body/rate limits, logging  │
                │            │  http://127.0.0.1:3000  (loopback only)               │
                │            ▼                                                       │
                │  Next.js (next start, systemd, user "eduplat")                     │
                │     ├──► PostgreSQL 16  127.0.0.1:5432 (not public)                │
                │     └──► STORAGE_ROOT /var/lib/eduplat/storage (private volume)    │
                └────────────────────────────────────────────────────────────────────┘
                            │ scheduled (owner-configured)
                            ▼
              Backups (off-server, encrypted):  DB dump  +  storage (incremental)  +  config/secrets
```

- **Public:** 80 and 443 (nginx only), plus SSH restricted to the
  owner's addresses or a VPN.
- **Loopback only:** the app on 3000 (`-H 127.0.0.1`) and PostgreSQL on
  5432 (`listen_addresses = 'localhost'`, or a private network if
  managed).
- **HTTPS:** nginx holds the certificate and terminates TLS. The app
  sees plain HTTP on loopback. Because `AUTH_URL=https://…` is set, the
  app issues `__Secure-`/`__Host-` cookies and builds every redirect from
  `AUTH_URL`, not from forwarded headers. This was tested with a spoofed
  `Host`.
- **Storage** is a directory on a persistent volume, readable only by
  the app user and never served by nginx. All access goes through the
  app's token-checked routes.

## G. Domain / DNS / TLS

1. **Domain:** register or choose a (sub)domain, e.g.
   `edu.example.com`. It must equal `AUTH_URL`'s host.
2. **DNS:** an `A` record to the server's IPv4. Add an `AAAA` record
   only if the server has IPv6 **and** nginx listens on `[::]:80` /
   `[::]:443`. Use a TTL of about 300 s during launch.
3. **TLS certificate:** an ACME/Let's Encrypt certificate via an ACME
   client (HTTP-01 on port 80, or DNS-01). Automate renewal (certificates
   last about 90 days) and reload nginx after renewal.
4. **HTTP → HTTPS:** the port-80 server block returns 301 (tested).
5. **HSTS:** the app already sends `Strict-Transport-Security:
   max-age=31536000; includeSubDomains`. Enable HTTPS on all
   subdomains first, because `includeSubDomains` applies to them.
6. **Secure cookies:** automatic with an https `AUTH_URL` (tested:
   `__Secure-authjs.session-token`, `__Host-authjs.csrf-token`,
   `Secure; HttpOnly; SameSite=Lax`).
7. **Reverse proxy:** use the nginx configuration in DEPLOYMENT.md §5,
   which this assessment updated for INF-2 and INF-3. It was re-verified
   8/8 through real TLS.

## H. Environment variables

| Variable | Class | Value | Where to keep it |
|---|---|---|---|
| `NODE_ENV` | REQUIRED | `production`, set by `next start` and by the systemd unit | unit file |
| `DATABASE_URL` | REQUIRED (secret) | `postgresql://eduplat:<pw>@127.0.0.1:5432/eduplat` | root-owned env file, mode 600 |
| `AUTH_SECRET` | REQUIRED (secret) | ≥ 32 random chars (`openssl rand -base64 48`). Changing it signs everyone out and voids links. | same env file + the owner's password manager |
| `AUTH_URL` | REQUIRED | `https://edu.example.com` (http only for localhost; the server refuses to start otherwise) | env file |
| `STORAGE_ROOT` | REQUIRED | `/var/lib/eduplat/storage`: absolute, outside the app directory, not under `public/` | env file |
| `APP_BASE_URL` | OPTIONAL | Same origin as `AUTH_URL` (a different origin logs a warning) | env file |
| `PORT` / `-p`, `-H` | OPTIONAL | `3000`, `127.0.0.1` | unit file |
| `SEED_TEACHER_EMAIL`, `SEED_TEACHER_PASSWORD` | FIRST DEPLOY ONLY (secret) | Pass inline to the one seed command; password ≥ 12 chars | shell for that one command, then **remove**; startup warns if present |
| `DEV_OUTBOX_DIR` | NEVER IN PRODUCTION | Development password-reset outbox | — |
| `AUTH_TRUST_HOST` | NEVER NEEDED | Superseded by `AUTH_URL`; not sufficient on its own | — |
| `NEXTAUTH_URL` | NEVER NEEDED | Legacy alias of `AUTH_URL`; set only one | — |
| any `.env`/`.env.test` file from development | NEVER IN PRODUCTION | They point to development databases | — |

Secrets live in one root-owned file, e.g. `/etc/eduplat/eduplat.env`
(mode 600, owner root). systemd reads it with `EnvironmentFile=`, so the
app user cannot modify it. Keep a copy in the owner's password manager
or secret store. **Never commit it to Git**: `.gitignore` already
excludes `.env*`, and only `.env.example` holds placeholders.

## I. PostgreSQL setup

**Sequence:**
1. Create the role and database.
   - Local: `createuser --pwprompt eduplat && createdb -O eduplat eduplat`.
   - Managed: create the database and user in the console, and restrict
     network access to the app server.
2. Put `DATABASE_URL` in the env file.
3. When upgrading an existing database, **back it up first**:
   `pg_dump -Fc` (DEPLOYMENT.md §4).
4. `npx prisma migrate deploy`
5. `npx prisma migrate status` → "Database schema is up to date!"
6. Create the first admin: `NODE_ENV=production SEED_TEACHER_EMAIL=… SEED_TEACHER_PASSWORD=… npm run db:seed`.
   - It refuses without both. It creates exactly one `TEACHER_ADMIN` and
     no demo accounts, and is safe to re-run (verified).
   - Then change the password once in the UI if it was shared.
7. Run the smoke tests (DEPLOYMENT.md §9).

**Connection limits:**
- One app instance keeps one Prisma pool of `CPUs × 2 + 1` connections
  (5 on 2 vCPU, 9 on 4 vCPU) plus short-lived CLI connections for
  migrations and the seed.
- The default `max_connections = 100` is ample. With a managed plan that
  has a low limit, add `?connection_limit=5` to `DATABASE_URL`.

**Backup and restore:** see §K and DEPLOYMENT.md §8. Always restore into
a **new** database first, verify it, then switch.

**Migration failure and rollback:**
- The migrations that could lose data abort **before** any DDL.
- Recovery: fix the data, run
  `prisma migrate resolve --rolled-back <name>`, then `migrate deploy`
  (tested, DEPLOYMENT.md §4).
- There are no down-migrations: roll back by restoring the pre-upgrade
  dump.

**Avoiding the development database by accident:**
- The production env file is the only source of `DATABASE_URL`, and no
  `.env` file is deployed.
- Use a distinct DB name and role (`eduplat`, not `eduplat_dev`).
- Before `migrate deploy`, run `npx prisma migrate status` and read the
  host and database it prints.
- Development machines never hold production credentials.

## J. Storage setup (`STORAGE_ROOT`)

```bash
# attached volume mounted persistently (fstab/systemd mount), e.g. at /var/lib/eduplat
sudo mkdir -p /var/lib/eduplat/storage
sudo chown eduplat:eduplat /var/lib/eduplat/storage
sudo chmod 700 /var/lib/eduplat/storage
```

Requirements:
- **outside** the app directory and outside `public/` (the latter is
  refused at startup);
- on a volume that survives reboot, redeploy and server rebuild;
- owned by the app user, mode 700; the app creates files 600 and
  subdirectories 700;
- never referenced by any nginx `root`/`alias`;
- included in backups (§K).

At start, the app refuses to run if the directory is missing and cannot
be created, not writable, or hangs (5 s probe).

**Verification** (run it once at launch; it is the same procedure as
the clean-clone reproduction, which passed):
1. Upload a video (> 10 MB, once INF-1 is fixed) and an attachment as
   the teacher.
2. `sha256sum` the new files in `$STORAGE_ROOT`.
3. `systemctl restart eduplat`, then download the attachment as the
   teacher and play the video as an entitled student. The checksums must
   match.
4. Back up (§K), restore to a new directory, point a test instance at it,
   and compare checksums.
5. Confirm a guest gets 401 on `/api/attachments/<id>` and 404 on any
   `/storage/...` or `/<key>` path.

## K. Backup strategy (plan — nothing is automated yet)

| What | How | Frequency | Retention | Off-site | Encryption |
|---|---|---|---|---|---|
| **Database** | `pg_dump -Fc` (or managed-DB automated backups + point-in-time recovery) | Nightly, **plus immediately before every migration** | 7 daily, 4 weekly, 3 monthly | Required: copy to storage on another provider/region | Encrypt at rest (encrypting backup tool or encrypted bucket); the dump contains personal data and password hashes |
| **Storage** | Incremental/deduplicating file backup of `STORAGE_ROOT`, e.g. `restic`, `borg` or `rsync --link-dest`. Files are immutable (new UUID per upload), so each night only new files are copied. A full `tar` each night (DEPLOYMENT.md example) only suits small libraries. | Nightly | Keep deleted files for ≥ 30 days | Required | Encrypted repository |
| **Config & secrets** | `/etc/eduplat/eduplat.env`, nginx site config, systemd unit, TLS renewal config | On every change | All versions | Owner's password manager / secret store (not the same backup bucket as the data) | Always |

**Restore testing:** one full test restore **before launch**, then
monthly (DB) and quarterly (storage sample + checksums), following
DEPLOYMENT.md §8.

**Backup storage size:** see §D. The storage backup is ≈ 1× the live
library, plus deleted files kept by retention. DB dumps are small
(expect < 1 GB in year 1).

## L. Monitoring

**Minimum required at launch:**

| Signal | How | Alert when |
|---|---|---|
| App + DB availability | HTTP check of `https://<domain>/api/health` every 1–5 min from outside the server. It returns 200 `{"status":"ok"}`, or **503** when PostgreSQL is unreachable. | 2 consecutive failures |
| Failed app starts | `systemctl status eduplat`; `journalctl -u eduplat` shows `[startup] error:` lines and exit code 1; systemd `Restart=on-failure` plus `StartLimitBurst` | Unit in `failed` state |
| Disk usage | `df -h` on the system disk and the storage volume (cron, or the host's metrics) | > 80 % |
| Backup success | The backup job writes a success timestamp / exit code; check that the newest backup is < 26 h old | Missing or failed backup |
| TLS expiry | ACME client renewal log, or the external check's certificate monitor | < 14 days left |

**Recommended later:**
- CPU, RAM and swap graphs (node exporter or the host's metrics);
- network throughput vs port speed and monthly egress vs quota;
- PostgreSQL connections and slow queries (`log_min_duration_statement`);
- log shipping and error tracking via `onRequestError`.

## M. Logging

| Source | Destination | Rotation | Contents |
|---|---|---|---|
| App (stdout/stderr) | journald (`journalctl -u eduplat`) | journald limits (`SystemMaxUse=`, e.g. 1 GB) | `[startup]` lines; one JSON line per server error (method, **path without query string**, route, digest, message); `[password-reset]` notice without email/token; `[stream]` accounting errors; Next.js warnings |
| nginx access | `/var/log/nginx/access.log` | logrotate (distro default: daily, 14 files, compressed) | **Use the `eduplat` log format** (DEPLOYMENT.md §5): `$uri` without the query string, so signed `?token=` values are never written (INF-2, measured) |
| nginx error | `/var/log/nginx/error.log` | logrotate | Upstream errors. nginx logs the full request line on errors, so treat this file as sensitive (see below). |
| PostgreSQL | `/var/log/postgresql/` | distro logrotate | Connections and errors; enable slow-query logging only if needed |

**Must never appear:** passwords, reset tokens, `AUTH_SECRET`, database
credentials, signed private URLs, or student personal data.

**Verified in code and runs:**
- The app strips query strings from its error lines.
- Reset tokens travel in the URL fragment, which never reaches the
  server.
- No `console.*` call prints a token, password or email.
- Startup messages name variables, never values.
- The nginx access log is clean with the `eduplat` format.
- **Residual:** nginx's *error* log includes the request line (with
  `?token=`) when an upstream error occurs. Keep it root-readable only,
  short retention (7–14 days), and never ship it to third parties
  unredacted.

**Disk impact** (estimate): access logs are ≈ 200 bytes per request, so
≈ 20–50 MB per day at a few hundred active users. Compressed rotation
keeps this under 1 GB.

**Inspecting errors:** `journalctl -u eduplat -p err --since "1 hour ago"`;
match a user-reported Arabic error page with the JSON line's `digest`.

## N. Security topology checklist

- **Firewall:** allow inbound 80/tcp and 443/tcp from anywhere; 22/tcp
  only from the owner's IPs or a VPN; **deny everything else**.
- **Not publicly reachable:**
  - PostgreSQL (5432): bind to localhost, or a private network plus an
    IP allow-list for managed DB;
  - the Node app (3000): bind to `127.0.0.1`;
  - `STORAGE_ROOT`: never served by nginx;
  - SSH, except from allowed IPs.
- **SSH:** key-only (`PasswordAuthentication no`), `PermitRootLogin no`,
  a named sudo user; optional fail2ban.
- **App process:** the systemd unit runs as a dedicated non-root user
  `eduplat` with no login shell. Suggested hardening: `NoNewPrivileges`,
  `ProtectSystem=full`, `ReadWritePaths=/var/lib/eduplat/storage`.
- **Storage:** the app user is the owner, mode 700; files 600.
- **TLS:** TLS 1.2/1.3 only (tested config), automatic renewal, HSTS
  from the app.
- **Cookies:** automatic with an https `AUTH_URL` (Secure, HttpOnly,
  SameSite=Lax, `__Secure-`/`__Host-` prefixes).
- **Rate limits:**
  - nginx: sign-in 10/min, register 10/min, reset 5/min, API 20/s per
    IP (tested: 429);
  - in the app: 5 failed logins per email per 15 min, atomic under
    parallel requests; 3 reset requests per email per 15 min.
- **Body limits:** nginx allows 30 MB by default, 510 MB on
  `/teacher/courses/` and 110 MB on `/teacher/shorts` (tested: 413).
- **OS updates:** unattended security updates enabled; reboot window
  monthly.
- **Secrets:** a root-owned env file, mode 600; never in Git, shell
  history, logs or tickets. Rotate `AUTH_SECRET` only deliberately (it
  signs everyone out).
- **Backups:** encrypted, off-site, access restricted to the owner.

## O. Exact deployment procedure (clean Ubuntu 24.04 server — not executed)

> Prerequisite: INF-1 fixed and released. Replace `edu.example.com`,
> `<release-commit>` and the paths as needed.

```bash
# 1. OS preparation (as a sudo user, not root)
sudo apt update && sudo apt -y full-upgrade
sudo apt -y install unattended-upgrades ufw git curl ca-certificates
sudo dpkg-reconfigure -plow unattended-upgrades
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 2. Node.js 22 LTS (from the distribution channel of your choice, e.g. NodeSource or a distro package providing 22.x)
node -v    # must print v22.x

# 3. PostgreSQL 16 (skip if using managed PostgreSQL)
sudo apt -y install postgresql-16          # Ubuntu 24.04 ships 16
sudo -u postgres createuser --pwprompt eduplat
sudo -u postgres createdb -O eduplat eduplat
# listen_addresses stays 'localhost' (default)

# 4. nginx + ACME client
sudo apt -y install nginx certbot python3-certbot-nginx

# 5. Application user and directories
sudo adduser --system --group --home /srv/eduplat --shell /usr/sbin/nologin eduplat
sudo mkdir -p /var/lib/eduplat/storage /etc/eduplat
# mount the storage volume at /var/lib/eduplat (fstab) before continuing
sudo chown -R eduplat:eduplat /var/lib/eduplat && sudo chmod 700 /var/lib/eduplat/storage

# 6. Repository (read-only deploy key or HTTPS token)
sudo -u eduplat git clone <repo-url> /srv/eduplat/app
sudo -u eduplat git -C /srv/eduplat/app checkout <release-commit>

# 7. Dependencies (dev dependencies are needed: prisma CLI, tsx, TypeScript)
cd /srv/eduplat/app && sudo -u eduplat npm ci

# 8. Environment (root-owned, never in Git)
sudo install -m 600 -o root -g root /dev/null /etc/eduplat/eduplat.env
sudoedit /etc/eduplat/eduplat.env
#   NODE_ENV=production
#   DATABASE_URL=postgresql://eduplat:<pw>@127.0.0.1:5432/eduplat
#   AUTH_SECRET=<openssl rand -base64 48>
#   AUTH_URL=https://edu.example.com
#   STORAGE_ROOT=/var/lib/eduplat/storage

# 9. Storage directory: done in step 5 (owner eduplat, mode 700)

# 10. Database migration
sudo -u eduplat env $(sudo cat /etc/eduplat/eduplat.env | xargs) npx prisma migrate deploy
sudo -u eduplat env $(sudo cat /etc/eduplat/eduplat.env | xargs) npx prisma migrate status   # "up to date", check host/db name

# 11. Initial admin (the password is typed once, not stored)
read -rs SEED_PW
sudo -u eduplat env $(sudo cat /etc/eduplat/eduplat.env | xargs) SEED_TEACHER_EMAIL=owner@edu.example.com SEED_TEACHER_PASSWORD="$SEED_PW" npm run db:seed
unset SEED_PW

# 12. Production build (needs no DB; ~1.5 GB RAM peak)
sudo -u eduplat npx prisma generate && sudo -u eduplat npm run build

# 13. systemd unit /etc/systemd/system/eduplat.service
#   [Unit]
#   Description=EduPlat (Next.js)
#   After=network.target postgresql.service
#   [Service]
#   User=eduplat
#   Group=eduplat
#   WorkingDirectory=/srv/eduplat/app
#   EnvironmentFile=/etc/eduplat/eduplat.env
#   ExecStart=/usr/bin/npm start -- -H 127.0.0.1 -p 3000
#   Restart=on-failure
#   RestartSec=5
#   NoNewPrivileges=true
#   ProtectSystem=full
#   ReadWritePaths=/var/lib/eduplat/storage /srv/eduplat/app/.next
#   [Install]
#   WantedBy=multi-user.target
sudo systemctl daemon-reload && sudo systemctl enable --now eduplat
journalctl -u eduplat -n 20    # "[startup] configuration and private storage checks passed"

# 14. nginx: DEPLOYMENT.md §5 config as /etc/nginx/sites-available/eduplat (+ symlink in sites-enabled)
sudo nginx -t && sudo systemctl reload nginx

# 15. TLS
sudo certbot --nginx -d edu.example.com      # or certonly + the §5 ssl_certificate paths
sudo certbot renew --dry-run

# 16. Firewall
sudo ufw default deny incoming && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw allow from <owner-ip> to any port 22 proto tcp
sudo ufw enable

# 17. Health check
curl -fsS https://edu.example.com/api/health         # {"status":"ok"}

# 18. Smoke tests: DEPLOYMENT.md §9 (HTTP checks + the manual role checklist),
#     including a > 10 MB video upload and its playback.

# 19. Backup: configure §K jobs, run them once by hand, and restore once into a new DB + directory (DEPLOYMENT.md §8).

# 20. Restart test
sudo systemctl restart eduplat && curl -fsS https://edu.example.com/api/health
#     then re-play the uploaded video and re-download the attachment (checksums unchanged).
```

## P. Rollback procedures

| Situation | Action | Safe without a restore? |
|---|---|---|
| Bad app release, no new migrations | `git checkout <previous>`, `npm ci`, build, restart | **Yes** |
| Bad app release with **additive** migrations (e.g. the 2026-09-26 ones) | Roll back the app only; the old code ignores new tables and columns | **Yes** |
| Migration failed mid-deploy | It aborted before DDL: fix the data, `migrate resolve --rolled-back`, `migrate deploy` (DEPLOYMENT.md §4) | **Yes** |
| Release whose migration changed or dropped data | Stop the app, restore the pre-upgrade dump into a new DB, switch `DATABASE_URL`, redeploy the previous build | **No — restore; data written after the dump is lost** |
| Database corruption or loss | Restore the latest dump (or managed PITR) into a new DB, verify (DEPLOYMENT.md §8), switch | Restore |
| Storage loss | Restore `STORAGE_ROOT` from the storage backup, then verify checksums against the DB's `storageKey`s | Restore |
| Corrupted single upload | The teacher re-uploads the file (replacement deletes the old file) | Yes |
| Failed deployment (won't start) | `journalctl -u eduplat`: `[startup] error:` names the variable. Fix the env or roll back the release | Yes |
| Server failure | New server via §O; restore DB + storage + config; repoint DNS (TTL 300 s) | Restore |

## Q. Scaling triggers (objective) and what comes next

| Trigger (sustained, e.g. 15 min at peak, repeatedly) | Next step (**future option — not implemented**) |
|---|---|
| Network throughput > 60–70 % of the port, or monthly egress approaching the quota | Move video delivery off the app server: object storage + CDN with signed URLs, or a video platform (HLS). Implemented by a new `StorageProvider` in `src/lib/storage/provider.ts`. |
| Concurrent streams × bitrate > port capacity (§E), or viewers far away with buffering complaints | Same as above; HLS adaptive bitrate needs a transcoding service |
| Storage volume > 75 % and growth continuing | Resize the volume; at ≈ 1,000+ videos or multi-TB, move to object storage |
| CPU > 70 % or RAM/swap pressure (> 85 % RAM, swapping) | Vertical resize first (4 → 8 vCPU, 8 → 16 GB) |
| PostgreSQL CPU > 60 %, p95 query > 200 ms, or connection saturation | Move PostgreSQL to its own server or a managed instance; add indexes guided by slow-query logs |
| Page p95 latency > 1 s (measured at launch: public pages ≤ 156 ms, student dashboard ≈ 203 ms at 10 concurrent) | Profile; vertical scale; then a second app instance, **only after** storage is shared or object storage |
| Nightly backup takes > 4 h, or restore time exceeds your tolerance | Snapshot-based volume backups; object storage with versioning |
| Multiple app instances wanted (availability) | Requires shared/object storage first. Sessions are JWT + DB checks, and locks are PostgreSQL advisory locks, so no other change is required. |

## R. Cost categories (no provider chosen, no prices invented)

| Category | Initial launch | Technical requirement to shop with |
|---|---|---|
| VPS / virtual server | **Required** | §B/§C: 4 vCPU / 8 GB recommended (2 / 4 minimum), SSD, 1 Gbit/s port, known monthly transfer quota, snapshot support, attachable block volume |
| Block storage volume | **Required** (or large local disk) | §D sizing, resizable, snapshot-capable |
| Managed PostgreSQL | Optional (replaces local PostgreSQL + DB backups) | PostgreSQL 16, private networking to the server, automated backups + PITR, ≥ 20 connections |
| Backup storage (off-site) | **Required** | ≈ 1–1.5× the storage volume + DB dumps; another region or provider; encryption; versioning/immutability |
| Domain | **Required** | Any registrar with DNS A/AAAA management |
| TLS certificate | **Required** (ACME certificates are free of charge) | ACME HTTP-01 or DNS-01 |
| Monitoring | **Required: an external uptime check** (§L minimum). Metrics/log SaaS optional | HTTP(S) check with alerting |
| Object storage / CDN / video platform | Optional now (§Q triggers) | Signed URLs; for video platforms HLS + tokenized playback |
| Email/SMS | Optional (manual reset paths exist) | Transactional email API or SMS gateway |

## S. Final pre-deployment checklist

- [ ] **INF-1 fixed, regression-tested with a > 10 MB upload, released** (application blocker)
- [ ] Server meets §B (minimum) or §C (recommended); swap configured
- [ ] Storage volume mounted persistently at `STORAGE_ROOT`'s parent; owner `eduplat`, mode 700
- [ ] PostgreSQL 16 reachable only locally or privately; `migrate status` up to date on the **production** DB
- [ ] `/etc/eduplat/eduplat.env` root-owned 600 with the 5 required variables; no `.env` files deployed; seed variables removed
- [ ] Build done; systemd unit enabled; the log shows "checks passed"
- [ ] nginx config from DEPLOYMENT.md §5 (with the `eduplat` log format and upload buffering); `nginx -t` clean
- [ ] DNS A (and AAAA if used) → server; TLS certificate issued; renewal dry-run passes
- [ ] Firewall: only 80/443 public, SSH restricted
- [ ] `/api/health` 200 over https; external uptime check alerting
- [ ] Smoke tests (DEPLOYMENT.md §9) pass, including a real video upload and playback
- [ ] Backups configured, run once, **restored once** and verified by checksums
- [ ] Restart test passed (files and sessions intact)
- [ ] Owner decisions recorded: manual/offline payments; password-reset procedure without email
- [ ] Teachers briefed: H.264/AAC MP4, ≤ ≈ 480 MB per video (≈ 20–25 min at 720p)

## T. Risks and assumptions

1. **Video bitrates and lengths are assumptions** (720p 1.5–3 Mbit/s,
   10–25 min). Measure real teacher uploads in the first month and redo
   §D/§E with actual numbers.
2. **Concurrency is not known.** No traffic numbers were invented. The
   tables show what 10/50/100 concurrent viewers would need; the owner
   supplies the expected class sizes.
3. **Measurements are from a 4 vCPU / 16 GB test environment over
   loopback.** Real throughput is bounded by the server's network port
   and the viewers' connections.
4. **Upload memory:** the app holds each upload in memory at about 3.1×
   the file size (measured 1.6 GB peak for 450 MB). Two teachers
   uploading large videos at once need about 3.2 GB free. This drives
   the 8 GB recommendation.
5. **Single point of failure:** one server holds app, DB and files.
   Recovery time is bounded by restore speed (§K) and DNS TTL. This is
   acceptable for a small launch if backups are tested.
6. **Upload over slow connections (INF-3):**
   - Node ends requests after 300 s.
   - With nginx buffering the upload first, the slow part happens
     between the browser and nginx, which only times out on 60 s of
     inactivity.
   - nginx then forwards the file to Node over loopback in seconds.
   - Measured: 408 at ≈ 300 s without the mitigation; the full upload
     completed over 410 s with it.
7. The **seed and the reset-link script need dev dependencies**
   (`tsx`), so `npm ci` must include them (it does by default).
8. **No automated backups, monitoring, scheduler, CDN, HLS/DRM, email or
   payment gateway exist.** Where this plan relies on them, the owner
   must provide them.
