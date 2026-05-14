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

async function syncGroup(groupId: number): Promise<void> {
	const claimed = await claimGroupSync(groupId);
	if (!claimed) return; // another process beat us to it

	const items = await findByGroupMembers(groupId);
	for (const item of items) {
		try {
			const token = getDecryptedAccessToken(item);
			const result = await syncTransactions(
				item.id,
				token,
				item.user_id,
				item.transactions_cursor
			);
			console.log(`[scheduledSync] group=${groupId} item=${item.id}`, result);
		} catch (e) {
			console.error(
				`[scheduledSync] group=${groupId} item=${item.id} failed`,
				e
			);
		}
	}

	await releaseGroupSync(groupId);
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
				} catch {}
			}
		}
		console.log("[scheduledSync] Tick complete");
	});

	console.log("[scheduledSync] Registered: every 30 minutes");
}
