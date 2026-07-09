# Rate Limiting

`node/src/middleware/rateLimit.ts` — a distributed **fixed-window** rate limiter
backed by Redis, so the limit is shared across every Node instance rather than
counted per-process. `rateLimit(options)` returns Express middleware from a
config, mirroring the `authorize*` middleware style.

## How a request is counted

- Key: `ratelimit:{keyPrefix}:{key}` where the default key is
  `user:{userId}` when authenticated, else `ip:{req.ip}` (which is why
  `app.set("trust proxy", 1)` matters behind a load balancer — see
  [backend-architecture.md](backend-architecture.md)).
- A single **atomic Lua script** does `INCR` + (`PEXPIRE` only on the first hit of
  the window) in one round-trip. This closes the classic race where a crash
  between INCR and EXPIRE leaves a key that never expires and locks a caller out
  forever.
- Responses carry `X-RateLimit-Limit` / `X-RateLimit-Remaining`; a blocked request
  gets `Retry-After` and throws `RateLimitError` (429 via the central error
  handler).
- Optional `onLimit(req)` hook fires just before the 429 (must not throw).

## Fails OPEN

If Redis is disabled (`REDIS_URL` unset) or errors mid-request, the request is
**allowed through** (no headers). A rate limiter is a guardrail, not a
correctness gate — it must never be the reason a legitimate request 500s.
(Locking, which does need correctness, stays on Postgres.)

## The two ready-made limiters

| Limiter | Window | Max | Keyed by | Mounted on |
|---|---|---|---|---|
| `authRateLimit` | 15 min | 10 | IP (unauthenticated) | `register`, `login`, `password-reset` in `routes/V1/index.ts` |
| `apiRateLimit` | 1 min | 120 | user id | every authenticated sub-router, after its `authenticate` |

`authRateLimit` blunts credential stuffing / brute force; a blocked auth request
is the loudest burst-attack signal there is, so its `onLimit` records a
`RATE_LIMITED` auth audit event (best-effort — see
[audit-pipeline.md](audit-pipeline.md)).

## Adding a limiter

```ts
export const linkTokenRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyPrefix: "plaid-link",   // unique prefix so counters don't collide
});
```

Give each limiter its own `keyPrefix`; mount it after `authenticate` if it should
be per-user, before if per-IP.
