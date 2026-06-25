import { redis } from "../../config/redis.js";

// Cache-aside (lazy) caching over Redis. The single entry point is cacheGetOrSet:
// return the cached value on a hit, otherwise run the loader, store its result,
// and return it.
//
// Best-effort by design. When Redis is disabled OR errors, every call simply
// falls through to the loader — the caller always gets correct (if uncached)
// data, never an exception from the cache layer. So adding a cache around a
// query can never change correctness, only latency.
//
// IMPORTANT for horizontal scaling: a shared Redis cache means writes must
// invalidate. After any mutation that changes cached data, call cacheInvalidate
// with the same key(s). Prefer short TTLs over relying solely on invalidation —
// a stale-but-bounded cache is easier to reason about than perfect invalidation.

/**
 * Return the cached JSON value at `key`, or compute it via `loader`, cache it
 * with `ttlSeconds`, and return it.
 */
export async function cacheGetOrSet<T>(
	key: string,
	ttlSeconds: number,
	loader: () => Promise<T>
): Promise<T> {
	if (!redis) return loader();

	try {
		const hit = await redis.get(key);
		if (hit !== null) return JSON.parse(hit) as T;
	} catch (e) {
		// Read failed — skip the cache, serve fresh.
		console.error(`[cache] get failed for ${key}, serving fresh:`, e);
		return loader();
	}

	const value = await loader();

	try {
		// "EX" = expire in seconds. Never cache undefined (JSON.stringify → undefined).
		if (value !== undefined) {
			await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
		}
	} catch (e) {
		// Write failed — value is still correct, just not cached for next time.
		console.error(`[cache] set failed for ${key}:`, e);
	}

	return value;
}

/** Drop one or more exact keys. Call after a write that changes cached data. */
export async function cacheInvalidate(...keys: string[]): Promise<void> {
	if (!redis || keys.length === 0) return;
	try {
		await redis.del(...keys);
	} catch (e) {
		console.error("[cache] invalidate failed:", e);
	}
}

/**
 * Drop every key matching a glob pattern (e.g. "dashboard:group:42:*").
 * Uses SCAN (non-blocking), not KEYS, so it's safe against a large keyspace.
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
	if (!redis) return;
	try {
		const stream = redis.scanStream({ match: pattern, count: 100 });
		for await (const keys of stream) {
			if (keys.length) await redis.del(...(keys as string[]));
		}
	} catch (e) {
		console.error(`[cache] pattern invalidate failed for ${pattern}:`, e);
	}
}
