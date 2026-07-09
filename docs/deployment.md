# Deployment

## The single Dockerfile

One multi-stage `Dockerfile` serves the whole stack:

| Stage | Purpose |
|---|---|
| `deps` | `npm ci` of **all** deps (dev tooling included) — shared base. |
| `dev` | Hot-reload image used by **every** dev compose service (backend, scheduler, frontend, test). No source COPY — `docker-compose.dev.yaml` bind-mounts source and a named volume preserves `node_modules`. Default CMD runs the backend via `nodemon --legacy-watch` + `tsx`; compose overrides `command:` for the scheduler (`worker.ts`), frontend (vite), and test (vitest). |
| `build` | Compiles the backend (`npm run build:server` → `node/dist`). |
| `prod` (default) | Production-deps-only runtime; copies the compiled output to `/usr/local/app/build` and runs `node build/src/server.js`. Backend **only** — the frontend is not deployed via this Dockerfile. |

`docker-compose.prod.yaml` builds the default (prod) target, reads
`.env.docker.prod`, exposes port 3000, `restart: unless-stopped`.

## What prod compose does NOT yet include

The prod compose currently runs only the API container. A full production
deployment also needs, provisioned separately:

- **Postgres** — hosted Supabase (the `supabase` connection string).
- **The scheduler worker** — a second container from the same image running
  `node build/src/worker.js` with `WORKER_ROLE=scheduler` (exactly one instance —
  see [scaling.md](scaling.md)). Without it there is no scheduled Plaid sync,
  audit shipping, or retention sweep.
- **Redis** — required only when running more than one API instance
  ([redis.md](redis.md)).
- **AWS SQS/Lambda/S3** — required only for audit export; the SDK uses the EC2
  instance role (no AWS secrets in env), and `AWS_ENDPOINT_URL` stays unset
  ([audit-pipeline.md](audit-pipeline.md)).
- **SMTP** — real credentials via `SMTP_HOST`/`SMTP_PORT`/`EMAIL_FROM`
  ([email.md](email.md)).
- **Frontend hosting** — `npm run build` → `dist/`, served statically (any static
  host/CDN), with `/api/*` reverse-proxied to the backend so cookies stay
  same-origin.
- **A load balancer / reverse proxy** in front of the API — `app.ts` already sets
  `trust proxy` to 1 hop.

## Health & lifecycle

- API: `GET /health` on :3000; worker: `GET /health` on :3005. The dev compose
  healthchecks hit these; reuse them for LB target checks.
- Both processes handle `SIGTERM`/`SIGINT` with graceful shutdown (close SSE
  streams, pg pool, Redis; force-exit after 10s) and exit on
  uncaught exceptions/rejections so the orchestrator restarts them clean.
