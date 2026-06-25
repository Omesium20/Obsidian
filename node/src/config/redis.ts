// Redis configuration.
//
// Redis backs three best-effort features: the cross-instance pub/sub backplane
// for SSE (services/realtime/eventBus.ts), distributed rate limiting
// (middleware/rateLimit.ts), and cache-aside caching (services/cache/cache.ts).
//
// It is intentionally OPTIONAL. If REDIS_URL is unset the app runs exactly as
// it did before: pub/sub falls back to in-process delivery, the rate limiter
// fails open, and the cache becomes a pass-through. This lets a single-node
// deployment ignore Redis entirely and only switch it on when scaling out.
//
// Unlike the pg pool (which process.exit(1)s on failure because the DB is a hard
// dependency), Redis errors only log — a Redis outage must degrade these
// features, never take the API down. Locking deliberately stays on Postgres.

import Redis, { RedisOptions } from "ioredis";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Mirror database.ts: load .env.dev for native runs. dotenv never overrides an
// already-set var, so this is a no-op once database.ts (or the container env)
// has populated process.env.
if (!process.env.supabase && !process.env.REDIS_URL) {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	dotenv.config({ path: join(__dirname, "../../../.env.dev") });
}

const REDIS_URL = process.env.REDIS_URL;

/** True when REDIS_URL is configured. Callers branch on this to stay no-op in
 *  single-node mode. */
export const redisEnabled = Boolean(REDIS_URL);

const options: RedisOptions = {
	// Don't queue commands forever if Redis is unreachable — fail fast so
	// best-effort callers can fall back instead of hanging the request.
	maxRetriesPerRequest: 2,
	// Exponential-ish backoff, capped at 5s, for transient disconnects.
	retryStrategy: (times: number) => Math.min(times * 200, 5000),
};

/** Main command connection — used for caching, rate limiting, and PUBLISH.
 *  null when Redis is disabled. */
export const redis: Redis | null = redisEnabled
	? new Redis(REDIS_URL!, options)
	: null;

/** Dedicated subscriber connection. ioredis (like Redis itself) forbids running
 *  normal commands on a connection once it enters subscribe mode, so the
 *  backplane needs its own connection separate from `redis`. null when disabled. */
export const redisSub: Redis | null = redisEnabled
	? new Redis(REDIS_URL!, options)
	: null;

if (redis) {
	redis.on("ready", () => console.log("[redis] command client connected"));
	redis.on("error", (e: Error) =>
		console.error("[redis] command client error:", e.message)
	);
}
if (redisSub) {
	redisSub.on("error", (e: Error) =>
		console.error("[redis] subscriber error:", e.message)
	);
}

/** Close both connections during graceful shutdown. Safe to call when disabled. */
export async function closeRedis(): Promise<void> {
	await Promise.allSettled([redis?.quit(), redisSub?.quit()]);
}
