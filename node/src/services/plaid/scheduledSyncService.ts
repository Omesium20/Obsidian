import cron from "node-cron";
import {
	getGroupsDueForSync,
	resetStaleGroupLocks,
	claimGroupSync,
	releaseGroupSync,
} from "../../repository/groupRepository.js";
import {
	findByGroupMembers,
	getDecryptedAccessToken,
} from "../../repository/plaidItemRepository.js";
import { syncTransactions } from "./transactionsSyncService.js";
import { refreshItemBalances } from "./balanceRefreshService.js";
import { publishToGroup } from "../realtime/eventBus.js";
import { invalidateGroupSummaries } from "../cache/dashboardCache.js";

async function syncGroup(groupId: number): Promise<void> {
	const claimed = await claimGroupSync(groupId);
	if (!claimed) return; // another process beat us to it

	const items = await findByGroupMembers(groupId);
	let totalAdded = 0;
	let totalModified = 0;
	let totalRemoved = 0;
	for (const item of items) {
		try {
			const token = getDecryptedAccessToken(item);
			// Refresh balances + snapshot first so the net-worth series stays
			// current; a balance failure shouldn't block the transaction sync.
			try {
				await refreshItemBalances(token);
			} catch (e) {
				console.error(
					`[scheduledSync] balance refresh group=${groupId} item=${item.id} failed`,
					e
				);
			}
			const result = await syncTransactions(
				item.id,
				token,
				item.user_id,
				item.transactions_cursor
			);
			totalAdded += result.added;
			totalModified += result.modified;
			totalRemoved += result.removed;
			console.log(`[scheduledSync] group=${groupId} item=${item.id}`, result);
		} catch (e) {
			console.error(
				`[scheduledSync] group=${groupId} item=${item.id} failed`,
				e
			);
		}
	}

	await releaseGroupSync(groupId);

	// Drop the group's cached summaries BEFORE notifying, so the refetch that
	// sync:complete triggers reads fresh data rather than a stale cache entry.
	await invalidateGroupSummaries(groupId);

	// Notify every open dashboard in this household so they refetch their own
	// (per-user) summary. Best-effort — a no-op if nobody has it open.
	publishToGroup(groupId, "sync:complete", {
		added: totalAdded,
		modified: totalModified,
		removed: totalRemoved,
		at: new Date().toISOString(),
	});
}

export function startScheduledSync(): void {
	cron.schedule("*/30 * * * *", async () => {
		console.log("[scheduledSync] Cron tick");

		try {
			await resetStaleGroupLocks();
		} catch (e) {
			console.error("[scheduledSync] Stale lock reset failed", e);
		}

		let groups;
		try {
			groups = await getGroupsDueForSync();
		} catch (e) {
			console.error("[scheduledSync] Failed to fetch due groups", e);
			return;
		}

		if (groups.length === 0) {
			console.log("[scheduledSync] No groups due");
			return;
		}

		console.log(`[scheduledSync] ${groups.length} group(s) due`);
		for (const group of groups) {
			try {
				await syncGroup(group.id);
			} catch (e) {
				console.error(`[scheduledSync] group=${group.id} uncaught`, e);
				try {
					await releaseGroupSync(group.id);
				} catch (releaseErr) {
					// Best-effort lock release after an already-failed sync. If
					// this also fails, resetStaleGroupLocks clears the lock on a
					// later tick — log and move on rather than crash the cron.
					console.error(
						`[scheduledSync] group=${group.id} lock release failed`,
						releaseErr
					);
				}
			}
		}
		console.log("[scheduledSync] Tick complete");
	});

	console.log("[scheduledSync] Registered: every 30 minutes");
}
