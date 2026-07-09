# Horizontal Scaling

The codebase is built so the API tier can scale to N instances behind a load
balancer for availability and throughput. This page is the checklist of what
makes that safe and what to actually do.

## Why the API is scale-out safe

- **Stateless requests.** Auth is cookie JWTs verified per-request; no
  server-side session store, so any instance can serve any request. No sticky
  sessions required.
- **SSE across instances.** An SSE socket is pinned to one instance, but events
  are fanned out over the Redis pub/sub backplane: publish once, every instance
  delivers to its own local clients ([realtime-sse.md](realtime-sse.md)).
- **Shared rate limits.** Counters live in Redis, so a limit is enforced
  fleet-wide instead of per-process ([rate-limiting.md](rate-limiting.md)).
- **Shared cache with invalidation.** The cache-aside layer is one Redis
  keyspace; mutations invalidate group-wide so no instance serves another's stale
  data ([caching.md](caching.md)).
- **Cron extracted to a worker.** The Plaid sync scheduler used to run inside the
  API process, which would make N instances fire N cron ticks racing for the same
  group locks every 30 minutes (thundering herd). It now lives in the dedicated
  scheduler worker (`node/src/worker.ts`) so the cron fires once per tick. The
  Postgres claim lock still guards correctness — running >1 worker is *safe* —
  but one worker keeps the herd at size 1.
- **Correctness stays in Postgres.** Group sync locks (`groups.is_syncing`),
  audit-outbox claims (`FOR UPDATE SKIP LOCKED`), refresh-token state — none of
  it depends on Redis, which is allowed to fail.
- **Proxy-aware.** `app.set("trust proxy", 1)` resolves the real client IP from
  `X-Forwarded-For` behind one LB hop, keeping IP-keyed rate limits meaningful.
- **Orchestrator-friendly lifecycle.** `/health` endpoints on both processes,
  graceful `SIGTERM` shutdown, fail-fast exits on unrecoverable errors.

## Deployment shape

```
            ┌────► API instance 1 ─┐
 LB ────────┼────► API instance 2 ─┼──► Postgres (Supabase)
 (health:   └────► API instance N ─┘        ▲
  /health)              ▲                   │
                        │ pub/sub, limits,  │
                        ▼ cache             │
                      Redis ◄── scheduler worker (exactly 1) ──► SQS
```

- **API instances**: as many as needed. All get `REDIS_URL`.
- **Scheduler worker**: exactly **one**, with `WORKER_ROLE=scheduler` (skips the
  Redis subscriber connection — it's publisher-only) and the SQS vars if audit
  export is on.
- **Redis**: single shared instance. It is a hard requirement only in multi-node
  mode — without it each instance would enforce its own rate limits, hold its own
  event island (SSE clients on instance A would miss syncs published on B), and
  cache independently.
- **Postgres connections**: each instance opens its own pg pool. Watch aggregate
  connection count against Supabase's limits; add Supavisor/pgbouncer pooling
  when instance count grows. (Related deferred plan: swap the Plaid sync
  flag-lock for `pg_advisory_lock` once a pooler is in place.)

## Single-node mode still works

All of this is opt-in. Leave `REDIS_URL` unset and one API process behaves
exactly as the original single-instance build — in-process events, fail-open
rate limiting, pass-through cache ([redis.md](redis.md)). The scheduler worker is
still worth running as a separate process, but `startScheduledSync` can be wired
back into `server.ts` for a truly minimal deployment.

## Rules to preserve when adding features

1. Never keep request-scoped or user-scoped state in process memory — put it in
   Postgres (correctness) or Redis (best-effort).
2. Anything cross-client/live goes through `publishToGroup`, never directly to a
   local socket map.
3. New cron/interval jobs go in `worker.ts`, not `server.ts`.
4. New caches must be invalidated on every mutation path, or carry a short TTL.
5. Redis usage must degrade gracefully — check `redis`/`redisEnabled` for null
   and fail open/fall through.
