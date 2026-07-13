# Deployment

## Production architecture (current target)

Deliberately **single-node**: the expected user base is a handful of people, so
the design optimizes for cost and simplicity while keeping the scale-out path
open (see [scaling.md](scaling.md) — nothing below forecloses it).

```
                Browser
                   │
              CloudFront ────────────────────────────┐
               │       │                             │
        default        /api/* behavior               │
        behavior       (CachingDisabled +            │
        (S3 origin)     AllViewer, 60s origin        │
               │        response timeout)            │
               ▼       │                             │
        S3 bucket      ▼                             │
        (Vite dist/)   EC2 instance (one) ───────► Supabase Postgres (hosted)
                       docker compose:               ▲
                       ├─ backend    :3000 ──────────┘
                       ├─ scheduler  :3005 (health only) ──► SQS (audit, optional)
                       └─ redis      (compose-network only)
```

### Frontend: S3 + CloudFront

- `npm run build` → sync `dist/` to the S3 bucket → CloudFront invalidation.
  The bucket is private; CloudFront reads it via Origin Access Control.
- **SPA fallback**: a CloudFront Function on the default behavior's
  viewer-request rewrites extensionless paths to `/index.html`. Do **not** use
  CloudFront custom error responses for this — they apply distribution-wide, so
  a legitimate API 403/404 (e.g. `getSession()` on an expired session) would be
  rewritten to `index.html` with a 200 and silently break the API client's
  error handling.

### `/api/*` behavior: same origin, zero caching

The frontend is hard-wired to same-origin (`src/lib/api.ts` uses relative
`/api/v1/...` paths, httpOnly cookie auth, `EventSource` with credentials), so
the API is a second origin **behind the same CloudFront distribution** — never
a separate `api.` subdomain (that would break cookies and the relative paths).

- Cache policy `CachingDisabled` + origin request policy `AllViewer`: cookies,
  headers, and query strings all reach Express; nothing is ever cached.
- **Origin response timeout: 60s.** For the SSE stream this acts as an idle
  timeout; the server heartbeat is 25s (`eventsRoutes.ts`), so 60s leaves
  comfortable margin. The 30s default is too close to the heartbeat.
- CloudFront is the **single proxy hop** — it appends the client IP to
  `X-Forwarded-For`, matching `app.set("trust proxy", 1)`. Adding another
  forwarding layer (ALB, nginx) later means bumping that hop count or IP-keyed
  rate limits break.

### The EC2 instance

One instance runs the whole backend via `docker-compose.prod.yaml`
(three containers: `backend`, `scheduler`, `redis` — see below).

- **Networking**: security group allows inbound :3000 from the CloudFront
  managed prefix list only. No port 22 — admin access is SSM Session Manager
  (`aws ssm start-session`), which needs no inbound rules.
- **IAM instance role**: `AmazonSSMManagedInstanceCore`, plus
  `sqs:SendMessage` scoped to the audit queue when audit export is on. The SDK
  picks up the role automatically — no AWS keys in `.env.docker.prod`.
- **Deploys**: `git pull && docker compose -f docker-compose.prod.yaml up -d
  --build` on the box (cheapest; revisit ECR if builds outgrow the instance).

### Failure modes (by design)

| Down | Effect |
|---|---|
| `redis` container | App fully operational, degraded: per-process rate limits (fail open), pass-through cache, in-process-only events. Never a 500. |
| `scheduler` container | Data goes stale: no Plaid sync, audit outbox accumulates in Postgres (nothing lost — drains on restart), retention paused. API unaffected. |
| The instance | Backend down. CloudFront still serves the SPA shell from S3; API calls fail until compose's `restart: unless-stopped` + a rebooted instance recover. |

### Scaling path (kept open, not built)

Single-node is a choice, not a constraint ([scaling.md](scaling.md)). To scale:
move Redis off-box (all API instances get `REDIS_URL`), put an ALB or more
origins behind CloudFront (recount `trust proxy` hops), run N API instances —
and keep **exactly one** scheduler.

## The single Dockerfile

One multi-stage `Dockerfile` serves the whole stack:

| Stage | Purpose |
|---|---|
| `deps` | `npm ci` of **all** deps (dev tooling included) — shared base. |
| `dev` | Hot-reload image used by **every** dev compose service (backend, scheduler, frontend, test). No source COPY — `docker-compose.dev.yaml` bind-mounts source and a named volume preserves `node_modules`. Default CMD runs the backend via `nodemon --legacy-watch` + `tsx`; compose overrides `command:` for the scheduler (`worker.ts`), frontend (vite), and test (vitest). |
| `build` | Compiles the backend (`npm run build:server` → `node/dist`). |
| `prod` (default) | Production-deps-only runtime; copies the compiled output to `/usr/local/app/build` and runs `node build/src/server.js`. Backend **only** — the frontend deploys to S3, not via this image. |

## Production compose

`docker-compose.prod.yaml` builds the default (prod) target from the same image
for both Node processes, reads `.env.docker.prod`, and runs three services:

- **`backend`** — the API, only published port (:3000, CloudFront's origin).
- **`scheduler`** — same image, `command: node build/src/worker.js`,
  `WORKER_ROLE=scheduler`, exactly one instance (owns all cron work).
- **`redis`** — best-effort backplane, reachable only inside the compose
  network. No hard `depends_on` condition: Redis being down must degrade the
  app, never block it ([redis.md](redis.md)).

All services: `restart: unless-stopped` + healthchecks, so compose acts as the
process supervisor (no orchestrator).

## Provisioned separately from this repo

- **Postgres** — hosted Supabase (the `supabase` connection string).
- **S3 + CloudFront + EC2 + IAM** — Terraform (`terraform/` — module layout,
  state-bucket bootstrap, and apply workflow in [terraform.md](terraform.md)).
- **SMTP** — real credentials via `SMTP_HOST`/`SMTP_PORT`/`EMAIL_FROM`
  ([email.md](email.md)).
- **AWS SQS/Lambda/S3** — only for audit export; `AWS_ENDPOINT_URL` stays unset
  in prod so the SDK hits real AWS via the instance role
  ([audit-pipeline.md](audit-pipeline.md)).

## Health & lifecycle

- API: `GET /health` on :3000; worker: `GET /health` on :3005. Both dev and
  prod compose healthchecks hit these; reuse them for LB target checks if a
  load balancer is ever added.
- Both processes handle `SIGTERM`/`SIGINT` with graceful shutdown (close SSE
  streams, pg pool, Redis; force-exit after 10s) and exit on
  uncaught exceptions/rejections so the supervisor restarts them clean.
