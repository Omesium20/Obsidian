# Backend Architecture

Layered request flow: **routes → middleware → services → repositories → pg Pool**.

## Entry points

There are **two** processes built from the same codebase:

- `node/src/server.ts` — the API server: verifies the DB with `pool.connect()`,
  listens on `PORT` (default 3000), wires `SIGINT`/`SIGTERM` to a graceful shutdown
  that closes open SSE streams (`closeAllClients`), the pg pool, and Redis
  connections, then forces exit after 10s. `uncaughtException`/`unhandledRejection`
  log loudly and exit so the orchestrator restarts clean.
- `node/src/worker.ts` — the scheduler worker: same DB fail-fast contract, serves
  only `GET /health` (liveness for the container healthcheck, port 3005), and
  registers the three cron/interval jobs: `startScheduledSync` (Plaid),
  `startAuditRetention`, `startAuditShipper`. The Plaid cron deliberately does
  **not** run in `server.ts` anymore — see [scaling.md](scaling.md).

## App wiring — `node/src/app.ts`

- `app.set("trust proxy", 1)` — one proxy hop (the load balancer), so `req.ip`
  resolves the real client address from `X-Forwarded-For`; the IP-keyed rate
  limiters depend on this. Harmless with no proxy.
- `helmet()` mounts **first** so even parser errors get security headers, then
  `express.json()` and `cookie-parser`.
- `GET /health` (unauthenticated) for healthchecks.
- Mounts `/api/v1`.
- One terminal error handler: normalizes malformed-JSON parse errors
  (`type === "entity.parse.failed"`) into a `ValidationError`, formats `AppError`
  subclasses as `{ status, errorCode, message, details, timestamp }` with their
  `statusCode`, and falls back to a detail-free `INTERNAL_ERROR` 500 for anything
  else.

## Routes — `node/src/routes/V1/index.ts`

Single router for all v1 endpoints.

| Tier | Mounts | Notes |
|---|---|---|
| Public | `register`, `login`, `password-reset` | wrapped in the IP-keyed `authRateLimit` |
| Public | `logout`, `session` | no rate limit |
| Authenticated | `users`, `transactions`, `groups`, `accounts`, `invitations`, `plaid`, `dashboard`, `events` (SSE) | each sub-router mounts `authenticate` then the per-user `apiRateLimit` |
| Admin | `admin` | |

## Middleware — `node/src/middleware/`

- `validate` — Zod schema validation (schemas in `node/src/schemas/`).
- `authenticate` — cookie JWT + silent refresh; see [auth.md](auth.md).
- `authorizeAdmin` / `authorizeCreator` / `authorizeMember` — role gates over the
  JWT's `role`/`groupId`.
- `attachFreshToken` — sets a refreshed access-token cookie on the response.
- `rateLimit` — Redis fixed-window limiter factory; see
  [rate-limiting.md](rate-limiting.md).

## Services — `node/src/services/`

Business logic. Notable subtrees:

- `auth/` — `loginService`, `logoutService`, `registrationService`,
  `refreshService`, `passwordResetService`.
- `plaid/` — link, sync, balances, recurring, scheduled sync; see [plaid.md](plaid.md).
- `audit/` — `authEventService` (best-effort auth audit events),
  `auditShipperService`, `auditRetentionService`; see
  [audit-pipeline.md](audit-pipeline.md).
- `cache/` — generic `cache.ts` + `dashboardCache.ts`; see [caching.md](caching.md).
- `realtime/` — `eventBus.ts` (SSE registry + Redis pub/sub); see
  [realtime-sse.md](realtime-sse.md).

## Repositories — `node/src/repository/`

**All SQL lives here.** One file per table/aggregate, raw SQL over the shared
`pool` from `config/database.ts` (no ORM). `dashboardRepository.ts` is the largest
— all the aggregate queries behind the dashboard summary, transaction pages, and
net-worth series.

## Errors — `node/src/errors/`

Custom `AppError` hierarchy: `AuthenticationError`, `AuthorizationError`,
`ConflictError`, `DatabaseError`, `ExternalServiceError`, `NotFoundError`,
`RateLimitError`, `ValidationError`. **Always throw these** (not raw `Error`) so
the central handler can format the response.

## Express 5 conventions

Async route handlers do **not** need `try/catch` — thrown errors propagate to the
error middleware automatically. Don't add wrapper utilities or try/catch
boilerplate in route handlers.
