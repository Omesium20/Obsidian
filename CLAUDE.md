# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian Financial is a full-stack TypeScript application with two halves living in one repo:

- **Frontend** (`src/`): React 19 + Vite + Tailwind 4. Currently a shell — `main.tsx` is the entry, `landing page.tsx` is a placeholder. `features/`, `hooks/`, `tests/` directories exist but are empty.
- **Backend** (`node/src/`): Express 5 API server, mounted at `/api/v1`. Talks to a Supabase-hosted Postgres over the `pg` driver (no ORM — raw SQL in repository files).

The two halves use different `tsconfig` files (`tsconfig.app.json` for the client, `tsconfig.server.json` for the server, `rootDir: ./node`, `outDir: ./node/dist`).

## Commands

```bash
npm run dev          # Vite dev server (frontend, native)
npm run server       # Backend with nodemon + tsx (hot reload, runs node/src/server.ts)
npm run build        # tsc -b && vite build (frontend production build)
npm run build:server # Compile backend to node/dist/
npm run lint         # ESLint over the repo
npm test             # Vitest (single run, integration tests against local Postgres)

# Containerized dev stack
npm run dev:up       # supabase start + docker compose dev up (backend + frontend, hot reload)
npm run dev:down     # docker compose dev down + supabase stop
npm run test:docker  # Run vitest inside the test container against .env.test
```

Run a single test file: `npx vitest run node/src/tests/repository/userRepository.test.ts`

The test runner is configured with named projects in `vitest.config.ts` — to run one project: `npx vitest run --project users` (or `accounts`, `groups`, `transactions`, `refreshTokens`).

## Environment files

| File | Purpose | Loaded by |
|---|---|---|
| `.env.dev` | Backend dev runtime (DB connection, JWT secrets, SMTP). Hosts use `host.docker.internal` so the dev container can reach Supabase + Mailpit on the host. | `node/src/config/database.ts` (native) and `docker-compose.dev.yaml` `env_file` (containerized). |
| `.env.test` | Test DB connection + JWT secrets. Points at the `obsidian_test` database via `host.docker.internal:54322`. | `vitest.config.ts` (via dotenv) and the `test` service in `docker-compose.dev.yaml`. |
| `.env.docker.prod` | Prod container runtime. Read by `docker-compose.prod.yaml`. | Existing prod build only. |

`.gitignore` excludes all `.env*` files.

## Dev environments

Two ways to run the dev stack — pick one per session, **don't run both at once** (port conflicts):

**Native:** `npx supabase start` (once), then `npm run server` (terminal 1) and `npm run dev` (terminal 2). Fast iteration, debuggable from the IDE, doesn't need Docker beyond Supabase.

**Containerized:** `npm run dev:up`. Spins up Supabase via the CLI, then builds and starts a `backend` container (Express, port 3000) and `frontend` container (Vite, port 5173) using `Dockerfile.dev` and `Dockerfile.frontend.dev`. Both have hot reload — source is bind-mounted, file watching uses polling (`--legacy-watch` for nodemon, `CHOKIDAR_USEPOLLING=true` for Vite) so changes are detected reliably through Docker bind mounts on Windows. The Vite proxy points at `http://backend:3000` via the `VITE_PROXY_TARGET` env var so `/api/*` reaches the sibling backend container instead of host loopback.

`docker-compose.dev.yaml` also defines an on-demand `test` service (behind a `test` profile) that runs `vitest run` inside a container using `.env.test`. Trigger it via `npm run test:docker`.

## Backend Architecture

Layered request flow: **routes → middleware → services → repositories → pg Pool**.

- `node/src/app.ts` — Express app: JSON + cookie-parser middleware, mounts `/api/v1`, has a single terminal error handler that special-cases `AppError` subclasses (returns `statusCode`, `errorCode`, `message`, `details`, `timestamp`) and falls back to `INTERNAL_ERROR` 500 for anything else.
- `node/src/server.ts` — entry point: calls `pool.connect()` to verify DB, listens on `PORT` (default 3000), wires `SIGINT`/`SIGTERM` to a graceful shutdown that closes `pool` and forces exit after 10s.
- `node/src/routes/V1/index.ts` — single router for all v1 endpoints. Public routes: `register`, `login`, `logout`, `password-reset`. Authenticated: `users`, `transactions`, `groups`, `accounts`, `invitations`. Admin: `admin`.
- `node/src/middleware/` — `validate` (Zod schema validation), `authenticate` (see auth flow below), `authorizeAdmin`/`authorizeCreator`/`authorizeMember` (role gates), `attachFreshToken`.
- `node/src/services/` — business logic. `services/auth/` contains `loginService`, `logoutService`, `registrationService`, `refreshService`, `passwordResetService`.
- `node/src/repository/` — all SQL lives here. One file per table/aggregate. Repositories use the shared `pool` from `config/database.ts`.
- `node/src/schemas/` — Zod request schemas, consumed by the `validate` middleware.
- `node/src/errors/` — custom `AppError` hierarchy: `AuthenticationError`, `AuthorizationError`, `ConflictError`, `DatabaseError`, `ExternalServiceError`, `NotFoundError`, `ValidationError`. Always throw these (not raw `Error`) so the central handler can format the response.

### Auth flow (important)

Cookie-based JWTs, not Authorization headers:

- **Access token**: 15-min HS256 JWT, `req.cookies.access_token` (with optional `Bearer ` prefix). Payload is `{ userId, groupId, role }` — `groupId`/`role` come from the user's active `group_memberships` row.
- **Refresh token**: 7-day JWT, `req.cookies.refreshToken`. Stored server-side as a SHA-256 hash in `refresh_tokens` (see `utils/hashing.ts`, `repository/refreshTokenRepository.ts`).
- The `authenticate` middleware does **silent refresh**: on `TokenExpiredError` for the access token, it pulls the refresh cookie, calls `refreshTokens()` (which rotates — old token revoked, new pair issued), sets new cookies, and continues. There's also a 30-min inactivity limit enforced in `refreshService.ts`; if exceeded, all of the user's refresh tokens are revoked.
- Passwords are hashed with **argon2**. Tokens (refresh + invitation + password-reset) are hashed with SHA-256 before storage.
- Required env vars (`utils/jwt.ts` throws on import if missing): `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Connection string env var is `supabase` (lowercase — `config/database.ts`).

### Express 5 conventions

This project is on Express 5, so async route handlers do not need `try/catch` — thrown errors propagate to the error middleware automatically. Don't add wrapper utilities or try/catch boilerplate in route handlers.

## Database

Schema is managed via Supabase CLI migrations in `supabase/migrations/` (timestamped `.sql` files, applied in lexicographic order). Core tables:

- `users`, `groups`, `group_memberships` (a user can belong to one active group at a time — `findActiveMembership` filters by `departed_at IS NULL`)
- `accounts`, `account_members`, `account_group_visibility`, `account_transactions`, `transactions` (Plaid-shaped)
- `invitations`, `password_reset_tokens`, `refresh_tokens`, `audit_log`
- RLS is enabled on most tables (`20251223001447_blanket_RLS.sql`, `20260421005059_enable_rls_refresh_tokens_audit_log.sql`)
- A trigger revokes all refresh tokens on password change (`20260423110202_revoke_sessions_on_password_change.sql`)

## Testing

Integration tests run against a real local Postgres (Supabase CLI's bundled instance, reached via `host.docker.internal:54322` so the same connection string works from the host and from inside containers).

`vitest.config.ts` calls `dotenv.config({ path: ".env.test" })` at the top of the file — this must happen before any module imports because `database.ts` creates its pool at import time. The connection string and `NODE_ENV=test` come from `.env.test`.

`node/src/tests/globalSetup.ts` derives the admin connection (for the `postgres` superuser DB) from the test URL and drops/recreates the `obsidian_test` database from `supabase/migrations/*.sql` on every run. Tests are configured with `fileParallelism: false` because all projects share one database — parallel TRUNCATE/INSERT would deadlock. Keep this in mind when adding new tests.

The local Supabase stack must be running for tests to work (`npx supabase start`). For containerized test runs use `npm run test:docker`.

## Email

`node/src/config/email.ts` configures nodemailer. In dev/test it points at Supabase's bundled SMTP (port 54325, viewable via Mailpit). In production it requires `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`, and SMTP credentials, and uses `secure: true`.

## Deployment

`Dockerfile` is a multi-stage build that compiles **only** the backend (`npm run build:server`) into `node/dist`, copies it to `/usr/local/app/build`, and runs `node build/server.js`. The frontend isn't deployed via this Dockerfile. `docker-compose.prod.yaml` reads `.env.docker.prod` and exposes port 3000.

`Dockerfile.dev` and `Dockerfile.frontend.dev` are dev-only counterparts used by `docker-compose.dev.yaml` — they install all deps and run nodemon / vite respectively against bind-mounted source. Don't use them for production builds.
