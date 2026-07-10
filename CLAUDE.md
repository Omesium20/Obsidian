# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code
in this repository. It is an index — the full documentation lives in `docs/`.
**When working on a topic, read its doc first.** Keep this file under 200 lines;
put detail in the topic docs and expand them there. Whenever a new feature or architectural change
is made you will make a new document to describe that feature in detail. However if we make
a change systematically we will document that change.
We also would need to edit content when possible on a change.

## Project Overview

Obsidian Financial is a household personal-finance app: link banks via Plaid,
invite family into a shared household, get a live dashboard of balances,
transactions, subscriptions, and net worth. Full-stack TypeScript, one repo:

- **Frontend** (`src/`): React 19 + Vite + Tailwind 4 SPA. Custom router, cookie
  auth, Recharts. `tsconfig.app.json`.
- **API server** (`node/src/server.ts`): Express 5 at `/api/v1`. Raw SQL over
  `pg` to Supabase Postgres (no ORM). `tsconfig.server.json` → `node/dist`.
- **Scheduler worker** (`node/src/worker.ts`): separate process for all cron work
  (Plaid sync, audit retention, audit→SQS shipper) so scaled API instances don't
  each run the cron.
- **Optional infra** (unset env = feature off, app unaffected): Redis (SSE
  pub/sub backplane, distributed rate limiting, caching) and SQS→Lambda→S3 audit
  export (LocalStack in dev).

## Documentation map (`docs/`)

| Doc                                                       | Read when working on                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [project-overview.md](docs/project-overview.md)           | Architecture, process topology, repo layout, design principles                         |
| [commands.md](docs/commands.md)                           | All npm scripts, running single tests/projects                                         |
| [environment.md](docs/environment.md)                     | `.env*` files, env var reference, native vs containerized dev, LocalStack              |
| [backend-architecture.md](docs/backend-architecture.md)   | app/server/worker wiring, routes, middleware, services, repositories, errors           |
| [frontend-architecture.md](docs/frontend-architecture.md) | Router, pages, dashboard feature, API client, session handling, styles                 |
| [auth.md](docs/auth.md)                                   | JWT cookies, silent refresh, inactivity limit, hashing                                 |
| [database.md](docs/database.md)                           | Migrations, tables, RLS, locks, column conventions (amount sign, Plaid taxonomy)       |
| [redis.md](docs/redis.md)                                 | Redis config, optional/degrade semantics, connections, WORKER_ROLE                     |
| [realtime-sse.md](docs/realtime-sse.md)                   | SSE endpoint, event bus, pub/sub fan-out, adding events                                |
| [caching.md](docs/caching.md)                             | Cache-aside layer, dashboard summary cache, invalidation rules                         |
| [rate-limiting.md](docs/rate-limiting.md)                 | Limiter middleware, fail-open policy, auth/api limiters                                |
| [audit-pipeline.md](docs/audit-pipeline.md)               | audit_log outbox, SQS shipper, Lambda archiver, retention                              |
| [plaid.md](docs/plaid.md)                                 | Link flow, transaction sync, cadence, balances, recurring, net worth, token encryption |
| [group-lifecycle.md](docs/group-lifecycle.md)             | Registration, invites, leave/kick, personal-group restore                              |
| [account-visibility.md](docs/account-visibility.md)       | Sharing/privacy, co-ownership, deletion/transfer                                       |
| [testing.md](docs/testing.md)                             | Vitest projects, global setup, helpers, Plaid test pattern                             |
| [deployment.md](docs/deployment.md)                       | Production architecture (CloudFront + S3 + single EC2), Dockerfile stages, prod compose |
| [scaling.md](docs/scaling.md)                             | Horizontal scaling: what makes it safe, deployment shape, rules                        |
| [email.md](docs/email.md)                                 | Nodemailer config, dev Mailpit vs prod SMTP                                            |

## Commands (most used — full list in docs/commands.md)

```bash
npm run dev          # Vite dev server (frontend, native)
npm run server       # Backend, nodemon + tsx hot reload
npm test             # Vitest integration tests (needs npx supabase start)
npm run lint         # ESLint
npm run dev:up       # Containerized stack: backend + scheduler + frontend + Redis + LocalStack
npm run dev:down     # Tear the stack down
npm run test:docker  # Vitest inside the test container

npx vitest run --project users            # one vitest project
npx vitest run node/src/tests/repository/userRepository.test.ts  # one file
```

Pick **one dev environment per session** — native or containerized, not both
(port conflicts).

## Critical rules (violating these breaks things)

- **Leave the DB/SMTP host on `127.0.0.1` in `.env.dev`/`.env.test` — do not
  "fix" it.** Compose overrides just those vars to `host.docker.internal` for
  containers; pointing a _native_ run there makes startup time out and exit. See
  docs/environment.md.
- **Express 5**: async route handlers need no try/catch — errors propagate to the
  central handler. Don't add wrappers. Always throw `AppError` subclasses
  (`node/src/errors/`), never raw `Error`.
- **All SQL lives in `node/src/repository/`**; business logic in services;
  request validation in Zod schemas + the `validate` middleware.
- **`transactions.amount`: positive = inflow, negative = outflow.** Plaid returns
  the opposite; the sync service flips the sign. Manual entries use the natural
  sign (no flip).
- **Redis/SQS are optional and best-effort.** Check `redis`/`sqsClient` for null;
  fail open (rate limits), fall through (cache), deliver locally (events). A
  Redis outage must never 500 a request. Correctness locking stays on Postgres.
- **New cron/interval jobs go in `worker.ts`, not `server.ts`** — the API scales
  horizontally; the worker runs as one instance (docs/scaling.md).
- **After any mutation that changes cached data, invalidate before responding or
  publishing** (`invalidateGroupSummaries` for dashboard data — docs/caching.md).
- **New test files need a new project entry in `vitest.config.ts`** with
  `testTimeout` set inside the project (root value not inherited). Tests share
  one DB — `fileParallelism: false` stays.
- **Client and server `INACTIVITY_LIMIT_MS` must stay in sync**
  (`src/lib/api.ts` ↔ `node/src/services/auth/refreshService.ts`).
- **`createPersonalGroupForUser` is the single source of truth for solo state** —
  never duplicate the group+membership+visibility logic inline.
- **`PLAID_ENCRYPTION_KEY` rotation requires re-encrypting all `plaid_items`
  rows** first; `.env.test` uses a different key.
- **Containerized stack + new npm dep**: run `npm run dev:clear` (drops the
  named node_modules volumes) or the dep is `MODULE_NOT_FOUND`.

## Environment quick reference

Required: `supabase` (lowercase, PG URL), `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `PLAID_CLIENT_ID`, `PLAID_SANDBOX_SECRET` (prod:
`PLAID_PRODUCTION_SECRET`), `PLAID_ENCRYPTION_KEY` (32-byte hex).
Optional switches: `REDIS_URL`, `WORKER_ROLE=scheduler`, `SQS_AUDIT_QUEUE_URL`,
`AWS_ENDPOINT_URL` (LocalStack; unset in prod). Details: docs/environment.md.
