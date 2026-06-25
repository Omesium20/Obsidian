import { cacheGetOrSet, cacheInvalidatePattern } from "./cache.js";

// Caching for the dashboard /summary endpoint.
//
// The summary payload is PER-USER (each member sees their own my_* slices and a
// personalized member-enrichment list), so the cache key includes both groupId
// and userId. But the data a summary reflects is GROUP-WIDE (a sync, a shared
// account, or any member's transaction changes the aggregates every member
// sees), so invalidation is done at the group level — drop every member's cached
// summary at once via a key pattern.
//
// TTL is deliberately short. It's the staleness bound for write paths we don't
// explicitly invalidate (manual transaction add/edit, account create/edit/share):
// those self-heal within SUMMARY_TTL_SECONDS instead of needing an invalidate
// call threaded through every mutation. Sync completion — the highest-frequency,
// SSE-visible change — IS invalidated explicitly (see scheduledSyncService).

const SUMMARY_TTL_SECONDS = 30;

const summaryKey = (groupId: number, userId: number): string =>
	`dashboard:summary:g${groupId}:u${userId}`;

/** Return the cached summary for this user, or compute + cache it via `loader`. */
export function getOrSetSummary<T>(
	groupId: number,
	userId: number,
	loader: () => Promise<T>
): Promise<T> {
	return cacheGetOrSet(summaryKey(groupId, userId), SUMMARY_TTL_SECONDS, loader);
}

/** Drop every member's cached summary for a group. Call after a write (before
 *  responding, so the client's refetch can't beat the clear) or before
 *  broadcasting a change (e.g. sync:complete). No-op for a null/undefined group
 *  so callers can pass req.user.groupId without a non-null assertion. */
export function invalidateGroupSummaries(
	groupId: number | null | undefined
): Promise<void> {
	if (groupId == null) return Promise.resolve();
	return cacheInvalidatePattern(`dashboard:summary:g${groupId}:*`);
}
