# Caching

Cache-aside (lazy) caching over Redis. Best-effort by design: when Redis is
disabled or errors, every call falls through to the loader — the caller always
gets correct (if uncached) data, never an exception from the cache layer. Adding a
cache around a query can change latency, never correctness.

## Generic layer — `services/cache/cache.ts`

| Function | Behavior |
|---|---|
| `cacheGetOrSet(key, ttlSeconds, loader)` | Return the cached JSON value, or run the loader, `SET … EX ttl`, and return it. Never caches `undefined`. |
| `cacheInvalidate(...keys)` | `DEL` exact keys. Call after a write that changes cached data. |
| `cacheInvalidatePattern(pattern)` | Delete every key matching a glob (e.g. `dashboard:summary:g42:*`). Uses `SCAN` (non-blocking), not `KEYS`, so it's safe against a large keyspace. |

**Horizontal-scaling rule:** a shared Redis cache means writes must invalidate.
After any mutation that changes cached data, call `cacheInvalidate` with the same
key(s). Prefer **short TTLs** over relying solely on invalidation — a
stale-but-bounded cache is easier to reason about than perfect invalidation.

## The one current consumer — `services/cache/dashboardCache.ts`

Caches the dashboard `GET /dashboard/summary` payload (the most expensive query
set in the app — see `dashboardRepository.ts`).

- **Key**: `dashboard:summary:g{groupId}:u{userId}` — the payload is **per-user**
  (each member sees their own `my_*` slices), so the key includes both ids.
- **Invalidation is group-wide**: the data a summary reflects is group-wide (a
  sync or any member's change moves the aggregates every member sees), so
  `invalidateGroupSummaries(groupId)` drops every member's entry at once via the
  key pattern. Null/undefined groupId is a safe no-op.
- **TTL 30s** (`SUMMARY_TTL_SECONDS`) — the staleness bound for write paths that
  aren't explicitly invalidated; they self-heal within the TTL.

### Who invalidates

- `scheduledSyncService.syncGroup` — **before** publishing `sync:complete`, so
  the refetch the event triggers can't beat the clear
  ([realtime-sse.md](realtime-sse.md)). Covers cron and on-demand syncs.
- `accountRoutes` — account create/edit/delete, visibility, joint flag,
  co-owner add/remove.
- `transactionRoutes` — manual transaction create/edit/delete.

Same rule route-side: invalidate **before responding**, so the client's follow-up
refetch can't race a stale entry.

## Adding a cache to a new endpoint

1. Add a keyed wrapper in `services/cache/` (follow `dashboardCache.ts` — don't
   scatter raw key strings through routes).
2. Pick a short TTL that bounds acceptable staleness.
3. Invalidate from every mutation path that changes the data, before the response
   or event that would trigger a re-read.
