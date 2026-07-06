import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { apiRateLimit } from "../../middleware/rateLimit.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { createLinkToken } from "../../services/plaid/linkTokenService.js";
import { exchangePublicToken } from "../../services/plaid/itemService.js";
import { exchangePublicTokenSchema } from "../../schemas/plaidSchemas.js";
import {
	findByGroupMembers,
	findByUserId,
	getDecryptedAccessToken,
} from "../../repository/plaidItemRepository.js";
import {
	claimGroupSync,
	releaseGroupSync,
	getGroupSyncStatus,
} from "../../repository/groupRepository.js";
import { syncTransactions } from "../../services/plaid/transactionsSyncService.js";
import { getRecurringOutflows } from "../../services/plaid/recurringService.js";
import { refreshItemBalances } from "../../services/plaid/balanceRefreshService.js";
import { publishToGroup } from "../../services/realtime/eventBus.js";

const router = Router();

router.use(authenticate, apiRateLimit, authorizeMember);

router.post("/link-token", async (req, res) => {
	const { link_token, expiration } = await createLinkToken(req.user!.userId);
	res.status(200).json({ link_token, expiration });
});

router.post(
	"/exchange-token",
	validate({ body: exchangePublicTokenSchema }),
	async (req, res) => {
		const result = await exchangePublicToken(
			req.user!.userId,
			req.user!.groupId!,
			req.body.public_token
		);
		res.status(201).json({
			message: "Bank connected",
			institution_name: result.institutionName,
			accounts: result.accounts,
			transaction_count: result.transactionCount,
		});
	}
);

router.post("/sync", async (req, res) => {
	const { groupId } = req.user!;
	if (!groupId) {
		res.status(400).json({ message: "No active group" });
		return;
	}

	const claimed = await claimGroupSync(groupId);
	if (!claimed) {
		res.status(409).json({ message: "Sync already in progress for this group" });
		return;
	}

	const items = await findByGroupMembers(groupId);
	let totalAdded = 0;
	let totalModified = 0;
	let totalRemoved = 0;
	const errors: Array<{ itemId: number; message: string }> = [];

	for (const item of items) {
		try {
			const token = getDecryptedAccessToken(item);
			// Refresh balances + snapshot before the transaction sync; a balance
			// failure is logged but doesn't fail the whole sync for this item.
			try {
				await refreshItemBalances(token);
			} catch (e) {
				console.error(`[sync] balance refresh item=${item.id} failed`, e);
			}
			const r = await syncTransactions(
				item.id,
				token,
				item.user_id,
				item.transactions_cursor
			);
			totalAdded += r.added;
			totalModified += r.modified;
			totalRemoved += r.removed;
		} catch (e) {
			errors.push({
				itemId: item.id,
				message: e instanceof Error ? e.message : String(e),
			});
		}
	}

	await releaseGroupSync(groupId);

	// Notify every open dashboard in this household (including the caller's
	// other tabs and any household members) so they refetch their own summary.
	publishToGroup(groupId, "sync:complete", {
		added: totalAdded,
		modified: totalModified,
		removed: totalRemoved,
		at: new Date().toISOString(),
	});

	const status = await getGroupSyncStatus(groupId);

	res.status(200).json({
		synced: items.length - errors.length,
		total: items.length,
		added: totalAdded,
		modified: totalModified,
		removed: totalRemoved,
		last_synced_at: status.last_synced_at?.toISOString() ?? null,
		...(errors.length > 0 && { errors }),
	});
});

// Recurring outflow streams (subscriptions/bills) for the dashboard panel,
// scoped to the same views the dashboard uses: "me" (default), "group", or
// "member-{id}". Member items are taken from the caller's own group list, so a
// member id outside the household simply yields no items — no separate
// membership check needed.
router.get("/recurring", async (req, res) => {
	const { userId, groupId } = req.user!;
	const view = typeof req.query.view === "string" ? req.query.view : "me";

	let items;
	if (view === "me") {
		items = await findByUserId(userId);
	} else if (!groupId) {
		res.status(200).json({ streams: [], errors: [] });
		return;
	} else {
		const groupItems = await findByGroupMembers(groupId);
		if (view === "group") {
			items = groupItems;
		} else {
			const memberMatch = /^member-(\d+)$/.exec(view);
			if (!memberMatch) {
				res.status(400).json({ message: "Invalid view" });
				return;
			}
			const memberId = parseInt(memberMatch[1], 10);
			items = groupItems.filter((i) => i.user_id === memberId);
		}
	}

	const result = await getRecurringOutflows(items);
	res.status(200).json(result);
});

router.get("/sync-status", async (req, res) => {
	const groupId = req.user!.groupId;
	if (!groupId) {
		res.status(200).json({ last_synced_at: null, is_syncing: false });
		return;
	}
	const status = await getGroupSyncStatus(groupId);
	res.status(200).json({
		last_synced_at: status.last_synced_at?.toISOString() ?? null,
		is_syncing: status.is_syncing,
	});
});

export default router;
