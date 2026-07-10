# Redis

`config/redis.ts` (ioredis). Redis backs three **best-effort** features:

1. Cross-instance pub/sub backplane for SSE — [realtime-sse.md](realtime-sse.md)
2. Distributed rate limiting — [rate-limiting.md](rate-limiting.md)
3. Cache-aside caching — [caching.md](caching.md)

## Optional by design

If `REDIS_URL` is unset the app runs exactly as a single-node build: pub/sub falls
back to in-process delivery, the rate limiter fails open, and the cache becomes a
pass-through. A single-node deployment can ignore Redis entirely and only switch
it on when scaling out. `redisEnabled` is the flag callers branch on.

In production Redis runs as a container on the same EC2 instance as the API and
scheduler ([deployment.md](deployment.md)) — reachable only inside the compose
network, no persistence (its contents are best-effort and rebuild from
Postgres). If that container dies the app degrades per the semantics above;
it moves to its own node only when the API scales past one instance.

Unlike the pg pool (which `process.exit(1)`s on failure because the DB is a hard
dependency), **Redis errors only log** — a Redis outage must degrade these
features, never take the API down. Correctness-critical locking deliberately stays
on Postgres ([database.md](database.md)).

## Connections

| Export | Purpose |
|---|---|
| `redis` | Command connection — cache GET/SET, rate-limit Lua eval, `PUBLISH`. `null` when disabled. |
| `redisSub` | Dedicated subscriber connection — Redis forbids normal commands on a connection in subscribe mode, so the backplane needs its own. `null` when disabled **or** when `WORKER_ROLE=scheduler`. |
| `closeRedis()` | Quits both during graceful shutdown; safe when disabled. |

`WORKER_ROLE=scheduler` marks the scheduler worker as **publisher-only**: it
PUBLISHes sync events but holds no SSE clients, so it skips the subscriber
connection and `eventBus`'s subscribe wiring no-ops there.

## Client options

- `maxRetriesPerRequest: 2` — fail fast so best-effort callers fall back instead
  of hanging a request while Redis is unreachable.
- `retryStrategy` — backoff capped at 5s for transient disconnects.

## Config resolution

Mirrors `database.ts`: for native runs, `.env.dev` is loaded only if nothing has
populated `process.env` yet. In the containerized dev stack, compose sets
`REDIS_URL=redis://redis:6379` on the `backend` and `scheduler` services
([environment.md](environment.md)).
