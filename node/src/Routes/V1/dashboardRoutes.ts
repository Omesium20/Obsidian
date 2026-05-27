import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { AuthenticationError } from "../../errors/index.js";
import { dashboardTxQuerySchema } from "../../schemas/dashboardSchemas.js";
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
	getMyTransactionsPaged,
	getGroupTransactionsPaged,
	getMemberTransactionsPaged,
} from "../../repository/dashboardRepository.js";

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

	// Phase 1: fetch all personal data + group metadata in one parallel round-trip.
	// Group info and member list come back here so we can branch on solo vs multi
	// without a second waterfall.
	const [user, group, members, myAccounts, myTxs, myMonthly, myCategories] =
		await Promise.all([
			getUserDashboardInfo(userId),
			getGroupDashboardInfo(groupId),
			getGroupDashboardMembers(groupId),
			getMyDashboardAccounts(userId),
			getMyDashboardTransactions(userId, 15),
			getUserDashboardMonthly(userId),
			getUserDashboardCategories(userId),
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
			owner_id: userId,
			owner_first_name: ownerFirst,
			owner_last_name: ownerLast,
		}));

		const membersWithData = members.map((m) => ({
			...m,
			monthly: myMonthly,
			categories: myCategories,
		}));

		res.status(200).json({
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
		});
		return;
	}

	// Multi-member group: fetch group-aggregated slices while also enriching each
	// member with their own monthly/category data. The requesting user's data is
	// already in hand from Phase 1 — reuse it instead of re-fetching.
	const [gAccounts, gTxs, gMonthly, gCategories, membersWithData] =
		await Promise.all([
			getGroupDashboardAccounts(groupId),
			getGroupDashboardTransactions(groupId, 15),
			getGroupDashboardMonthly(groupId),
			getGroupDashboardCategories(groupId),
			Promise.all(
				members.map(async (m) => {
					if (m.id === userId) {
						return {
							...m,
							monthly: myMonthly,
							categories: myCategories,
						};
					}
					const [monthly, categories] = await Promise.all([
						getUserDashboardMonthly(m.id),
						getUserDashboardCategories(m.id),
					]);
					return { ...m, monthly, categories };
				})
			),
		]);

	res.status(200).json({
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
	});
});

const TX_PAGE_LIMIT = 25;

// Get paginated transactions for the dashboard transaction list view.
router.get(
	"/transactions",
	validate({ query: dashboardTxQuerySchema }),
	async (req, res) => {
		const { userId, groupId } = req.user!;
		const { view, page, filter } = req.query as unknown as typeof dashboardTxQuerySchema._output;

		if (view === "me") {
			const result = await getMyTransactionsPaged(
				userId,
				page,
				TX_PAGE_LIMIT,
				filter
			);
			res.status(200).json({
				transactions: result.transactions,
				total: result.total,
				page,
				pages: Math.max(1, Math.ceil(result.total / TX_PAGE_LIMIT)),
				showOwner: false,
			});
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
				filter
			);
			res.status(200).json({
				transactions: result.transactions,
				total: result.total,
				page,
				pages: Math.max(1, Math.ceil(result.total / TX_PAGE_LIMIT)),
				showOwner: true,
			});
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
			filter
		);
		res.status(200).json({
			transactions: result.transactions,
			total: result.total,
			page,
			pages: Math.max(1, Math.ceil(result.total / TX_PAGE_LIMIT)),
			showOwner: false,
		});
	}
);

export default router;
