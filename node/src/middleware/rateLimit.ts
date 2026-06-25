import { Request, Response, NextFunction } from "express";
import { redis } from "../config/redis.js";
import { RateLimitError } from "../errors/index.js";

// Distributed fixed-window rate limiter backed by Redis, so the limit is shared
// across every Node instance rather than counted per-process. Returns Express
// middleware from a config, mirroring the existing authorize* middleware style.
//
// Single atomic Lua step does INCR + (PEXPIRE only on the first hit of a window).
// Doing it in one round-trip closes the classic race where a crash between INCR
// and EXPIRE leaves a key that never expires and locks a caller out forever.
//
// Fails OPEN: if Redis is disabled or unreachable, requests are allowed through.
// A rate limiter is a guardrail, not a correctness gate — it must never be the
// reason a legitimate request 500s. (Locking, which DOES need correctness, stays
// on Postgres precisely for this reason.)

// KEYS[1] = bucket key, ARGV[1] = window in ms. Returns the post-increment count.
const INCR_AND_EXPIRE = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

interface RateLimitOptions {
	/** Sliding window length in milliseconds. */
	windowMs: number;
	/** Max requests allowed per key per window. */
	max: number;
	/** Namespace so different limiters don't share counters (e.g. "login", "api"). */
	keyPrefix: string;
	/** Derive the per-caller key. Defaults to user id when authenticated, else IP. */
	keyFn?: (req: Request) => string;
}

const defaultKey = (req: Request): string =>
	req.user?.userId ? `user:${req.user.userId}` : `ip:${req.ip}`;

export function rateLimit(options: RateLimitOptions) {
	const { windowMs, max, keyPrefix, keyFn = defaultKey } = options;

	return async (req: Request, res: Response, next: NextFunction) => {
		// Disabled (single-node) → allow. No-op, no headers.
		if (!redis) return next();

		const key = `ratelimit:${keyPrefix}:${keyFn(req)}`;

		let count: number;
		try {
			count = (await redis.eval(
				INCR_AND_EXPIRE,
				1,
				key,
				windowMs.toString()
			)) as number;
		} catch (e) {
			// Redis hiccup → fail open. Log and let the request through.
			console.error("[rateLimit] redis error, allowing request:", e);
			return next();
		}

		const remaining = Math.max(0, max - count);
		res.setHeader("X-RateLimit-Limit", max);
		res.setHeader("X-RateLimit-Remaining", remaining);

		if (count > max) {
			const retryAfterSeconds = Math.ceil(windowMs / 1000);
			res.setHeader("Retry-After", retryAfterSeconds);
			throw new RateLimitError(retryAfterSeconds);
		}

		next();
	};
}

// Ready-made limiters. Tune to taste; these are sane starting points.
//
// Tight limit on auth endpoints to blunt credential stuffing / brute force —
// keyed by IP since the caller isn't authenticated yet.
export const authRateLimit = rateLimit({
	windowMs: 15 * 60_000,
	max: 10,
	keyPrefix: "auth",
});

// Generous limit on the authenticated API surface, keyed per user.
export const apiRateLimit = rateLimit({
	windowMs: 60_000,
	max: 120,
	keyPrefix: "api",
});
