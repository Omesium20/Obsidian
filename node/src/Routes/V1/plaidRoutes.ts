import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { createLinkToken } from "../../services/plaid/linkTokenService.js";
import { exchangePublicToken } from "../../services/plaid/itemService.js";
import { exchangePublicTokenSchema } from "../../schemas/plaidSchemas.js";
import {
	findByGroupMembers,
	getDecryptedAccessToken,
} from "../../repository/plaidItemRepository.js";
import {
	claimGroupSync,
	releaseGroupSync,
	getGroupSyncStatus,
} from "../../repository/groupRepository.js";
import { syncTransactions } from "../../services/plaid/transactionsSyncService.js";

const router = Router();

router.use(authenticate, authorizeMember);

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
	const { userId, groupId } = req.user!;
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
			const r = await syncTransactions(
				item.id,
				token,
				userId,
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
