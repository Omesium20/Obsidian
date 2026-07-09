# Environment & Dev Environments

## Environment files

`.gitignore` excludes all `.env*` files.

| File | Purpose | Loaded by |
|---|---|---|
| `.env.dev` | Backend dev runtime (DB, JWT secrets, SMTP, Plaid creds, optional Redis/SQS). | `config/database.ts` (native) + `docker-compose.dev.yaml` (containerized) |
| `.env.test` | Test DB + JWT secrets. `supabase` must be a full PG URL (`postgresql://postgres:postgres@127.0.0.1:54322/obsidian_test`). `PLAID_ENV=sandbox` + real sandbox creds needed only for `seedPlaidItem` tests. | `vitest.config.ts`, container `test` service |
| `.env.docker.prod` | Prod container runtime. | `docker-compose.prod.yaml` |

> **Leave the DB/SMTP host on `127.0.0.1` — do not "fix" it.** Native runs need
> loopback (Docker Desktop publishes Supabase's ports there); the containerized
> stack can't use loopback, so `docker-compose.dev.yaml` overrides just those vars
> to `host.docker.internal` via `environment:` on the `backend`/`scheduler`/`test`
> services. One set of files serves both modes. Pointing a *native* run at
> `host.docker.internal` makes `database.ts` time out and `server.ts`
> `process.exit(1)` on startup.

`config/redis.ts` and `config/sqs.ts` mirror `database.ts`: they `dotenv.config()`
`.env.dev` for native runs only if nothing has populated `process.env` yet (dotenv
never overrides an already-set var).

## Environment variable reference

**Required (backend throws at startup/import if missing):**

| Var | Used by |
|---|---|
| `supabase` (lowercase) | `config/database.ts` — Postgres connection string |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `utils/jwt.ts` (throws on import) |
| `PLAID_CLIENT_ID`, `PLAID_SANDBOX_SECRET` (or `PLAID_PRODUCTION_SECRET` in prod) | `config/plaid.ts` |
| `PLAID_ENCRYPTION_KEY` | `utils/plaidCrypto.ts` — 32-byte hex; throws on import if missing/wrong length. Rotating it requires re-encrypting all `plaid_items` rows; `.env.test` should use a different value. |

**Optional (feature switches — unset = feature off, app unaffected):**

| Var | Effect when set |
|---|---|
| `REDIS_URL` | Enables the Redis backplane: SSE pub/sub fan-out, distributed rate limiting, cache-aside cache. See [redis.md](redis.md). |
| `WORKER_ROLE=scheduler` | Marks the process publisher-only: no Redis subscriber connection is opened. Set on the scheduler worker only. |
| `SQS_AUDIT_QUEUE_URL` | Enables the audit→SQS shipper (scheduler worker). See [audit-pipeline.md](audit-pipeline.md). |
| `AWS_ENDPOINT_URL` | Points the AWS SDK at LocalStack (dev). Unset in prod → real AWS via the default credential chain (EC2 instance role). |
| `AWS_REGION` | Defaults to `us-east-1`. |
| `PORT` | 3000 (API) / 3005 (worker) by default. |
| `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM` + creds | Required in production only. See [email.md](email.md). |

## Dev environments

Pick one per session — **don't run both at once** (port conflicts):

### Native

```bash
npx supabase start    # once
npm run server        # backend
npm run dev           # frontend
```

Fast, IDE-debuggable. Redis/LocalStack are typically off natively (leave
`REDIS_URL`/`SQS_AUDIT_QUEUE_URL` unset) — everything degrades to single-node
behavior. To exercise them natively, start the containers yourself and set the
vars in `.env.dev`.

### Containerized — `npm run dev:up`

Supabase via CLI plus five compose services (`docker-compose.dev.yaml`), all built
from the **same `Dockerfile` `dev` target** (deps-only image; source is
bind-mounted, `nodemon --legacy-watch` / `CHOKIDAR_USEPOLLING` for reliable file
events on Windows):

| Service | Port | Runs | Notes |
|---|---|---|---|
| `backend` | 3000 | `server.ts` | `REDIS_URL=redis://redis:6379` so it subscribes to the worker's sync events + gets distributed rate limiting and the shared cache |
| `scheduler` | 3005 (health only) | `worker.ts` | `WORKER_ROLE=scheduler`, ships audit rows to LocalStack SQS |
| `frontend` | 5173 | Vite | proxy target `http://backend:3000` via `VITE_PROXY_TARGET` |
| `redis` | 6379 | `redis:7-alpine` | pub/sub backplane, rate limits, cache |
| `localstack` | 4566 | LocalStack 3 (`sqs,s3,lambda`) | emulates AWS locally — see below |
| `test` | — | vitest (on-demand, `--profile test`) | `npm run test:docker` |

### LocalStack (cloud services, locally)

The `localstack` service lets the audit-export pipeline run end-to-end without
touching real AWS. On startup LocalStack executes the init scripts in
`scripts/localstack/` (mounted at `/etc/localstack/init/ready.d`, lexicographic
order):

1. `01-create-queues.sh` — creates `audit-export.fifo` and `audit-export-dlq.fifo`
   with a redrive policy (`maxReceiveCount=5`).
2. `02-deploy-lambda.sh` — creates the `obsidian-audit` S3 bucket, zips and deploys
   `lambda/audit-archiver` (nodejs20.x), and wires the SQS→Lambda event-source
   mapping (`batch-size 10`, `ReportBatchItemFailures`).

The Lambda is deployed via `--zip-file` (not a code mount) because LocalStack runs
Lambdas as **sibling** Docker containers through the host socket — a path mounted
inside the LocalStack container doesn't exist on the host, so a code mount would
give the runtime an empty `/var/task`.

Dev/prod parity comes from `AWS_ENDPOINT_URL` alone: set → LocalStack (with
throwaway `test`/`test` credentials so SigV4 signing doesn't resolve a real
chain); unset → real AWS via the instance role. No code branching.

Useful inspection commands (inside the container or with `awslocal` locally):

```bash
docker exec obsidian-localstack-dev awslocal sqs list-queues
docker exec obsidian-localstack-dev awslocal s3 ls s3://obsidian-audit --recursive
docker exec obsidian-localstack-dev awslocal logs tail /aws/lambda/audit-archiver
```
