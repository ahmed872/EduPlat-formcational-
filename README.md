# EduPlat

A recorded-only educational platform in Arabic (RTL), for one teacher's
students and their parents: courses → lessons → private video with
server-enforced view limits, interactive experiments, quizzes and exams,
certificates with QR verification, parent reports, manual/offline
subscription payments.

Next.js 16 (App Router) · PostgreSQL 16 · Prisma 6 · Auth.js v5.

## Documents

| File | What it covers |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production setup: environment, migrations, reverse proxy/TLS, private storage, backups, smoke tests, rollback, go-live checklist |
| [SECURITY.md](SECURITY.md) | Authentication, sessions, authorization, video protection, payments, password recovery, hardening |
| [DATABASE.md](DATABASE.md) | Schema and migrations |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Code layout and design |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | What exists, test status, what remains |
| [FINAL_AUDIT_REPORT.md](FINAL_AUDIT_REPORT.md) | Audit findings, requirement coverage matrix, release decision |

## Development

```bash
npm ci
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
npx prisma migrate deploy
npm run db:seed               # development teacher account (printed; development only)
npm run dev                   # http://localhost:3000

npx tsc --noEmit && npx eslint . && npx vitest run   # tests need a PostgreSQL test database (.env.test)
```

Do not deploy this to a serverless host with an ephemeral filesystem:
uploaded videos and attachments live on a persistent private disk
(`STORAGE_ROOT`) served by a single Node.js process. See DEPLOYMENT.md.
