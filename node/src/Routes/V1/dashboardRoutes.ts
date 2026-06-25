import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { AuthenticationError } from "../../errors/index.js";
import {
	dashboardTxQuerySchema,
	dashboardTxCategoriesQuerySchema,
} from "../../schemas/dashboardSchemas.js";
import {
	getUserDashboardInfo,
	getGroupDashboardInfo,
	getGroupDashboardMembers,
	getMyDashboardAccounts,
	getGroupDashboardAccounts,
	getMyDashboardTransactions,
	getGroupDashboardTransactions,
	getUserDashboardMonthly,
	getGroupDashboardMonthly,
	getUserDashboardCategories,
	getGroupDashboardCategories,
	getUserNetWorthSeries,
	getGroupNetWorthSeries,
	getMyTransactionsPaged,
	getGroupTransactionsPaged,
	getMemberTransactionsPaged,
	getMyTransactionCategories,
	getGroupTransactionCategories,
	getMemberTransactionCategories,
} from "../../repository/dashboardRepository.js";
import type { PagedTransactions } from "../../repository/dashboardRepository.js";
import { getOrSetSummary } from "../../services/cache/dashboardCache.js";

const router = Router();
router.use(authenticate, authorizeMember);

// Get dashboar information
router.get("/summary", async (req, res) => {
	const { userId, groupId } = req.user!;

	// throws Authentication error should not happen but just a formality
	if (!groupId) {
		throw new AuthenticationError(
			"No active group found. Please log in again."
		);
	}

	// Cache the assembled payload per (group, user). It's the heaviest read in
	// the app (many parallel queries + a per-member enrichment fan-out), so a
	// short-TTL cache absorbs repeated loads. Invalidated group-wide on sync
	// (scheduledSyncService); other writes self-heal within the TTL.
	const payload = await getOrSetSummary(groupId, userId, () =>
		buildDashboardSummary(userId, groupId)
	);

	res.status(200).json(payload);
});

// Assembles the full /summary payload. Pure data-fetch + shaping (no req/res) so
// it can sit behind the cache loader above.
async function buildDashboardSummary(userId: number, groupId: number) {
	// Phase 1: fetch all personal data + group metadata in one parallel round-trip.
	// Group info and member list come back here so we can branch on solo vs multi
	// without a second waterfall.
	const [user, group, members, myAccounts, myTxs, myMonthly, myCategories, myNetWorth] =
		await Promise.all([
			getUserDashboardInfo(userId),
			getGroupDashboardInfo(groupId),
			getGroupDashboardMembers(groupId),
			getMyDashboardAccounts(userId, groupId),
			getMyDashboardTransactions(userId, 15, groupId),
			getUserDashboardMonthly(userId),
			getUserDashboardCategories(userId),
			getUserNetWorthSeries(userId),
		]);

	const isSolo = members.length <= 1;

	if (isSolo) {
		// Solo user: every account the user owns is their entire group. Derive all
		// group slices in-memory from the data we already have — no extra DB queries.
		const ownerFirst = user?.first_name ?? "";
		const ownerLast = user?.last_name ?? "";

		const groupAccounts = myAccounts.map((a) => ({
			...a,
			owner_id: userId,
			owner_first_name: ownerFirst,
			owner_last_name: ownerLast,
		}));

		const groupTxs = myTxs.map((t) => ({
			...t,
			is_private: false,
			owner_id: userId,
			owner_first_name: ownerFirst,
			owner_last_name: ownerLast,
		}));

		const membersWithData = members.map((m) => ({
			...m,
			monthly: myMonthly,
			categories: myCategories,
			net_worth: myNetWorth,
		}));

		return {
			user,
			group,
			members: membersWithData,
			my_accounts: myAccounts,
			group_accounts: groupAccounts,
			my_transactions: myTxs,
			group_transactions: groupTxs,
			my_monthly: myMonthly,
			group_monthly: myMonthly,
			my_categories: myCategories,
			group_categories: myCategories,
			my_net_worth: myNetWorth,
			group_net_worth: myNetWorth,
		};
	}

	// Multi-member group: fetch group-aggregated slices while also enriching each
	// member with their own monthly/category data. The requesting user's data is
	// already in hand from Phase 1 — reuse it instead of re-fetching.
	const [gAccounts, gTxs, gMonthly, gCategories, gNetWorth, membersWithData] =
		await Promise.all([
			getGroupDashboardAccounts(groupId),
			getGroupDashboardTransactions(groupId, 15),
			getGroupDashboardMonthly(groupId),
			getGroupDashboardCategories(groupId),
			getGroupNetWorthSeries(groupId),
			Promise.all(
				members.map(async (m) => {
					if (m.id === userId) {
						return {
							...m,
							monthly: myMonthly,
							categories: myCategories,
							net_worth: myNetWorth,
						};
					}
					const [monthly, categories, netWorth] = await Promise.all([
						getUserDashboardMonthly(m.id),
						getUserDashboardCategories(m.id),
						getUserNetWorthSeries(m.id),
					]);
					return { ...m, monthly, categories, net_worth: netWorth };
				})
			),
		]);

	return {
		user,
		group,
		members: membersWithData,
		my_accounts: myAccounts,
		group_accounts: gAccounts,
		my_transactions: myTxs,
		group_transactions: gTxs,
		my_monthly: myMonthly,
		group_monthly: gMonthly,
		my_categories: myCategories,
		group_categories: gCategories,
		my_net_worth: myNetWorth,
		group_net_worth: gNetWorth,
	};
}

const TX_PAGE_LIMIT = 25;

// Shapes a paged-transactions result into the list response. `summary` carries
// the full-set KPI aggregates (every matching transaction, not just this page) so
// the dashboard's Money in / out / Net cards reflect the whole filtered set.
function buildTxPageResponse(result: PagedTransactions, page: number, showOwner: boolean) {
	return {
		transactions: result.transactions,
		total: result.total,
		page,
		pages: Math.max(1, Math.ceil(result.total / TX_PAGE_LIMIT)),
		showOwner,
		summary: {
			total: result.total,
			sumIn: result.sumIn,
			sumOut: result.sumOut,
			countIn: result.countIn,
			countOut: result.countOut,
		},
		monthly: result.monthly,
	};
}

// Get paginated transactions for the dashboard transaction list view.
router.get(
	"/transactions",
	validate({ query: dashboardTxQuerySchema }),
	async (req, res) => {
		const { userId, groupId } = req.user!;
		const { view, page, filter, category, range, search } = req.query as unknown as typeof dashboardTxQuerySchema._output;

		if (view === "me") {
			const result = await getMyTransactionsPaged(
				userId,
				page,
				TX_PAGE_LIMIT,
				filter,
				category,
				range,
				search,
				groupId ?? undefined
			);
			res.status(200).json(buildTxPageResponse(result, page, false));
			return;
		}

		if (!groupId) {
			throw new AuthenticationError(
				"No active group found. Please log in again."
			);
		}

		if (view === "group") {
			const result = await getGroupTransactionsPaged(
				groupId,
				page,
				TX_PAGE_LIMIT,
				filter,
				category,
				range,
				search
			);
			res.status(200).json(buildTxPageResponse(result, page, true));
			return;
		}

		const memberId = parseInt(view.replace("member-", ""), 10);
		if (isNaN(memberId)) {
			res.status(400).json({ message: "Invalid view" });
			return;
		}
		const result = await getMemberTransactionsPaged(
			groupId,
			memberId,
			page,
			TX_PAGE_LIMIT,
			filter,
			category,
			range,
			search
		);
		res.status(200).json(buildTxPageResponse(result, page, false));
	}
);

// Returns the distinct list of categories available for the given view, used to
// populate the transaction-list category-filter dropdown. Scoped identically to
// the /transactions endpoint so the menu only offers categories that match rows
// the user can actually see.
router.get(
	"/transactions/categories",
	validate({ query: dashboardTxCategoriesQuerySchema }),
	async (req, res) => {
		const { userId, groupId } = req.user!;
		const { view } = req.query as unknown as typeof dashboardTxCategoriesQuerySchema._output;

		if (view === "me") {
			const categories = await getMyTransactionCategories(userId);
			res.status(200).json({ categories });
			return;
		}

		if (!groupId) {
			throw new AuthenticationError(
				"No active group found. Please log in again."
			);
		}

		if (view === "group") {
			const categories = await getGroupTransactionCategories(groupId);
			res.status(200).json({ categories });
			return;
		}

		const memberId = parseInt(view.replace("member-", ""), 10);
		if (isNaN(memberId)) {
			res.status(400).json({ message: "Invalid view" });
			return;
		}
		const categories = await getMemberTransactionCategories(groupId, memberId);
		res.status(200).json({ categories });
	}
);

export default router;
