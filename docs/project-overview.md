# Project Overview

Obsidian Financial is a household personal-finance app: users link their real bank
accounts via Plaid, invite family members into a shared "household" (group), and get
a live dashboard of balances, transactions, spending by category, recurring
subscriptions, and net worth over time — with per-account control over what is
shared with the household versus kept private.

It is a full-stack TypeScript application with both halves living in one repo.

## The pieces

| Piece | Where | What it is |
|---|---|---|
| Frontend | `src/` | React 19 + Vite + Tailwind 4 SPA. Custom ~50-line history router, cookie-auth API client, Recharts dashboards. See [frontend-architecture.md](frontend-architecture.md). |
| API server | `node/src/server.ts` | Express 5 API mounted at `/api/v1`. Stateless (scale-out safe); holds SSE connections for live dashboard refresh. See [backend-architecture.md](backend-architecture.md). |
| Scheduler worker | `node/src/worker.ts` | Separate long-running process for all cron work: the ~7-hour Plaid sync, audit retention sweep, and the audit→SQS shipper. Exists so horizontally-scaled API instances don't each run the cron. See [scaling.md](scaling.md). |
| Postgres | Supabase | System of record. Raw SQL via the `pg` driver — **no ORM**; all SQL lives in `node/src/repository/`. Schema via Supabase CLI migrations. See [database.md](database.md). |
| Redis | optional | Best-effort backplane: SSE pub/sub fan-out, distributed rate limiting, cache-aside caching. The app runs fine without it. See [redis.md](redis.md). |
| SQS → Lambda → S3 | optional (LocalStack in dev) | Audit-log export pipeline: `audit_log` outbox → SQS FIFO → `lambda/audit-archiver` → S3, with a DLQ. See [audit-pipeline.md](audit-pipeline.md). |
| Plaid | external | Bank linking, transaction sync, balances, recurring streams. See [plaid.md](plaid.md). |

## Request lifecycle (backend)

```
browser ──(cookies: access_token, refreshToken)──► Express 5
  helmet → express.json → cookie-parser
  → /api/v1 router
  → rate limit (Redis, fail-open)
  → authenticate (JWT + silent refresh)
  → authorize* (role gates)
  → validate (Zod)
  → route handler → service → repository → pg Pool
  → terminal error handler (AppError → structured JSON)
```

## Process topology

```
                    ┌────────────┐
 browser ◄──SSE──── │ API server │──┐
 browser ──HTTP───► │ (1..N)     │  │ SUBSCRIBE sync:complete
                    └─────┬──────┘  │ rate-limit counters, cache
                          │         ▼
                      Postgres    Redis ◄── PUBLISH ──┐
                          ▲                           │
                    ┌─────┴──────┐              ┌─────┴──────┐
                    │ audit_log  │──claim/ship─►│ scheduler  │──► SQS ─► Lambda ─► S3
                    │  (outbox)  │              │ worker (1) │
                    └────────────┘              └────────────┘
```

## Design principles that recur everywhere

- **Optional infrastructure degrades, never breaks.** Redis and SQS are opt-in via
  env vars. Unset = the app behaves exactly as a single-node build: pub/sub delivers
  in-process, the rate limiter allows everything, the cache is a pass-through, audit
  rows just accumulate unexported. Only Postgres is a hard dependency
  (`process.exit(1)` if unreachable).
- **Best-effort vs. correctness.** Anything that must be correct (sync locks,
  refresh-token state, money data) lives in Postgres. Anything that is a guardrail
  or an optimization (rate limits, cache, event fan-out, audit writes) is
  best-effort: errors are logged and swallowed so they can never 500 a valid request.
- **Fail fast on misconfiguration.** Missing JWT secrets, Plaid creds, or the
  encryption key throw at import/startup — never limp along half-configured.
- **All SQL in repositories, all business logic in services, all validation in Zod
  schemas.** Routes stay thin.

## Repo layout

```
src/                    React frontend (tsconfig.app.json)
node/src/               Express backend (tsconfig.server.json → node/dist)
  app.ts                Express app wiring (middleware, routes, error handler)
  server.ts             API entrypoint
  worker.ts             Scheduler-worker entrypoint
  config/               database, redis, sqs, plaid, email, types
  routes/V1/            one file per resource + index.ts mounting them
  middleware/           authenticate, authorize*, validate, rateLimit, attachFreshToken
  services/             business logic (auth/, plaid/, audit/, cache/, realtime/, …)
  repository/           raw SQL, one file per table/aggregate
  schemas/              Zod request schemas
  errors/               AppError hierarchy
  tests/                Vitest integration tests + helpers
lambda/audit-archiver/  SQS→S3 Lambda handler (deployed to LocalStack in dev)
scripts/localstack/     LocalStack init: create queues, deploy Lambda
supabase/migrations/    schema migrations (timestamped .sql)
docs/                   these docs
```
