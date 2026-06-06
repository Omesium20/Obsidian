import { pool } from "../config/database.js";
import { DatabaseError } from "../errors/index.js";

export interface DashboardUser {
	id: number;
	first_name: string;
	last_name: string;
	username: string;
	email: string;
}

export interface DashboardGroup {
	id: number;
	name: string;
	last_synced_at: string | null;
	is_syncing: boolean;
}

export interface DashboardMonthly {
	month: string;
	income: number;
	spending: number;
}

// One net-worth point per calendar month, derived from per-account balance
// snapshots (assets − liabilities). Oldest-to-newest, 'Mon YYYY' labels that
// line up with DashboardMonthly so charts share an x-axis.
export interface DashboardNetWorth {
	month: string;
	net_worth: number;
}

// A spending-by-category row scoped to a single calendar month. The dashboard
// returns these for a rolling 12-month window so the frontend can aggregate the
// categories that fall inside whatever timeframe (1M/3M/6M/1Y) the user picks —
// the same client-side slicing the monthly income/spending data uses.
export interface DashboardMonthlyCategory {
	month: string;
	category: string;
	total: number;
}

export interface DashboardMember {
	id: number;
	first_name: string;
	last_name: string;
	role: string;
	monthly: DashboardMonthly[];
	categories: DashboardMonthlyCategory[];
	net_worth: DashboardNetWorth[];
}

export interface DashboardAccount {
	id: number;
	account_name: string;
	type: string;
	subtype: string | null;
	institution_name: string | null;
	last_four: string | null;
	balance_current: number | null;
	balance_available: number | null;
	is_manual: boolean;
}

export interface DashboardGroupAccount extends DashboardAccount {
	owner_id: number;
	owner_first_name: string;
	owner_last_name: string;
}

export interface DashboardTransaction {
	id: number;
	transaction_date: string;
	amount: number;
	description: string | null;
	category: string | null;
	merchant_name: string | null;
	entry_method: string;
	account_id: number;
	account_name: string;
	institution_name: string | null;
	last_four: string | null;
}

export interface DashboardGroupTransaction extends DashboardTransaction {
	owner_id: number;
	owner_first_name: string;
	owner_last_name: string;
}

export type TxFilter = "all" | "income" | "spend";

function amountClause(filter: TxFilter): string {
	if (filter === "income") return " AND t.amount > 0";
	if (filter === "spend") return " AND t.amount < 0";
	return "";
}

// Returns a paginated page of the requesting user's own transactions.
// Joins account info for display (name, institution, last four digits).
// Includes owner identity fields so the response shape matches DashboardGroupTransaction
// and the frontend can render a consistent table regardless of view mode.
// `filter` narrows to income-only (amount > 0), spend-only (amount < 0), or all.
export const getMyTransactionsPaged = async (
	userId: number,
	page: number,
	limit: number,
	filter: TxFilter
): Promise<{ transactions: DashboardGroupTransaction[]; total: number }> => {
	const offset = (page - 1) * limit;
	const cond = amountClause(filter);
	try {
		const [dataRes, countRes] = await Promise.all([
			pool.query(
				`SELECT t.id, t.transaction_date, t.amount, t.description, t.category,
				        t.merchant_name, t.entry_method, akt.account_id, a.account_name, a.institution_name, a.last_four,
				        t.user_id AS owner_id, u.first_name AS owner_first_name, u.last_name AS owner_last_name
				 FROM transactions t
				 JOIN account_transactions akt ON t.id = akt.transaction_id
				 JOIN accounts a ON akt.account_id = a.id
				 JOIN users u ON u.id = t.user_id
				 WHERE t.user_id = $1${cond}
				 ORDER BY t.transaction_date DESC, t.id DESC
				 LIMIT $2 OFFSET $3`,
				[userId, limit, offset]
			),
			pool.query(
				`SELECT COUNT(*) AS total FROM transactions t WHERE t.user_id = $1${cond}`,
				[userId]
			),
		]);
		return {
			transactions: dataRes.rows as DashboardGroupTransaction[],
			total: Number(countRes.rows[0]?.total ?? 0),
		};
	} catch (e) {
		console.error("[getMyTransactionsPaged]", e);
		throw new DatabaseError("Failed to fetch user transactions (paged)", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns a paginated page of all transactions visible to a group.
// Uses account_group_visibility to scope results — only accounts explicitly shared
// with the group are included, regardless of who owns them.
// Includes owner identity fields (owner_id, first/last name) so the frontend can
// display which member each transaction belongs to when showOwner is true.
export const getGroupTransactionsPaged = async (
	groupId: number,
	page: number,
	limit: number,
	filter: TxFilter
): Promise<{ transactions: DashboardGroupTransaction[]; total: number }> => {
	const offset = (page - 1) * limit;
	const cond = amountClause(filter);
	try {
		const [dataRes, countRes] = await Promise.all([
			pool.query(
				`SELECT t.id, t.transaction_date, t.amount, t.description, t.category,
				        t.merchant_name, t.entry_method, akt.account_id, a.account_name, a.institution_name, a.last_four,
				        t.user_id AS owner_id, u.first_name AS owner_first_name, u.last_name AS owner_last_name
				 FROM transactions t
				 JOIN account_transactions akt ON t.id = akt.transaction_id
				 JOIN accounts a ON akt.account_id = a.id
				 JOIN account_group_visibility agv ON agv.account_id = a.id
				 JOIN users u ON u.id = t.user_id
				 WHERE agv.group_id = $1${cond}
				 ORDER BY t.transaction_date DESC, t.id DESC
				 LIMIT $2 OFFSET $3`,
				[groupId, limit, offset]
			),
			pool.query(
				`SELECT COUNT(*) AS total
				 FROM transactions t
				 JOIN account_transactions akt ON t.id = akt.transaction_id
				 JOIN account_group_visibility agv ON agv.account_id = akt.account_id
				 WHERE agv.group_id = $1${cond}`,
				[groupId]
			),
		]);
		return {
			transactions: dataRes.rows as DashboardGroupTransaction[],
			total: Number(countRes.rows[0]?.total ?? 0),
		};
	} catch (e) {
		console.error("[getGroupTransactionsPaged]", e);
		throw new DatabaseError("Failed to fetch group transactions (paged)", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns a paginated page of a specific group member's transactions, scoped to
// accounts that are visible to the group. The double filter (group_id + user_id)
// ensures a member can only be drilled into if their accounts are actually shared —
// transactions on unshared accounts are excluded even if they belong to that member.
export const getMemberTransactionsPaged = async (
	groupId: number,
	memberId: number,
	page: number,
	limit: number,
	filter: TxFilter
): Promise<{ transactions: DashboardGroupTransaction[]; total: number }> => {
	const offset = (page - 1) * limit;
	const cond = amountClause(filter);
	try {
		const [dataRes, countRes] = await Promise.all([
			pool.query(
				`SELECT t.id, t.transaction_date, t.amount, t.description, t.category,
				        t.merchant_name, t.entry_method, akt.account_id, a.account_name, a.institution_name, a.last_four,
				        t.user_id AS owner_id, u.first_name AS owner_first_name, u.last_name AS owner_last_name
				 FROM transactions t
				 JOIN account_transactions akt ON t.id = akt.transaction_id
				 JOIN accounts a ON akt.account_id = a.id
				 JOIN account_group_visibility agv ON agv.account_id = a.id
				 JOIN users u ON u.id = t.user_id
				 WHERE agv.group_id = $1 AND t.user_id = $2${cond}
				 ORDER BY t.transaction_date DESC, t.id DESC
				 LIMIT $3 OFFSET $4`,
				[groupId, memberId, limit, offset]
			),
			pool.query(
				`SELECT COUNT(*) AS total
				 FROM transactions t
				 JOIN account_transactions akt ON t.id = akt.transaction_id
				 JOIN account_group_visibility agv ON agv.account_id = akt.account_id
				 WHERE agv.group_id = $1 AND t.user_id = $2${cond}`,
				[groupId, memberId]
			),
		]);
		return {
			transactions: dataRes.rows as DashboardGroupTransaction[],
			total: Number(countRes.rows[0]?.total ?? 0),
		};
	} catch (e) {
		console.error("[getMemberTransactionsPaged]", e);
		throw new DatabaseError("Failed to fetch member transactions (paged)", {
			groupId,
			memberId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns a paginated page of transactions for a single account, newest-first.
// Scoped purely by account_id (via account_transactions); the caller is
// responsible for verifying the requesting user is allowed to see this account.
// Returns the plain DashboardTransaction shape (no owner fields) since every
// row trivially belongs to the one account being viewed.
export const getAccountTransactionsPaged = async (
	accountId: number,
	page: number,
	limit: number,
	filter: TxFilter
): Promise<{ transactions: DashboardTransaction[]; total: number }> => {
	const offset = (page - 1) * limit;
	const cond = amountClause(filter);
	try {
		const [dataRes, countRes] = await Promise.all([
			pool.query(
				`SELECT t.id, t.transaction_date, t.amount, t.description, t.category,
				        t.merchant_name, t.entry_method, akt.account_id, a.account_name, a.institution_name, a.last_four
				 FROM transactions t
				 JOIN account_transactions akt ON t.id = akt.transaction_id
				 JOIN accounts a ON akt.account_id = a.id
				 WHERE akt.account_id = $1${cond}
				 ORDER BY t.transaction_date DESC, t.id DESC
				 LIMIT $2 OFFSET $3`,
				[accountId, limit, offset]
			),
			pool.query(
				`SELECT COUNT(*) AS total
				 FROM account_transactions akt
				 JOIN transactions t ON t.id = akt.transaction_id
				 WHERE akt.account_id = $1${cond}`,
				[accountId]
			),
		]);
		return {
			transactions: dataRes.rows as DashboardTransaction[],
			total: Number(countRes.rows[0]?.total ?? 0),
		};
	} catch (e) {
		console.error("[getAccountTransactionsPaged]", e);
		throw new DatabaseError("Failed to fetch account transactions (paged)", {
			accountId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns basic profile info for the requesting user (id, name, username, email).
// Used to populate the user section of the dashboard summary response.
export const getUserDashboardInfo = async (userId: number): Promise<DashboardUser | null> => {
	try {
		const res = await pool.query(
			`SELECT id, first_name, last_name, username, email FROM users WHERE id = $1`,
			[userId]
		);
		return (res.rows[0] as DashboardUser) ?? null;
	} catch (e) {
		throw new DatabaseError("Failed to fetch user info", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns metadata for the group (id, name, last sync time, syncing flag).
// last_synced_at is normalised to ISO 8601 here so callers don't have to.
export const getGroupDashboardInfo = async (groupId: number): Promise<DashboardGroup | null> => {
	try {
		const res = await pool.query(
			`SELECT id, name, last_synced_at, is_syncing FROM groups WHERE id = $1`,
			[groupId]
		);
		const row = res.rows[0];
		if (!row) return null;
		return {
			id: row.id as number,
			name: row.name as string,
			last_synced_at: row.last_synced_at ? new Date(row.last_synced_at as string).toISOString() : null,
			is_syncing: row.is_syncing as boolean,
		};
	} catch (e) {
		throw new DatabaseError("Failed to fetch group info", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns all active members of a group ordered by join date (oldest first).
// Only includes memberships where departed_at IS NULL — departed members are excluded.
// Does not include monthly/category data; the route layer attaches those separately.
export const getGroupDashboardMembers = async (
	groupId: number
): Promise<Omit<DashboardMember, "monthly" | "categories">[]> => {
	try {
		const res = await pool.query(
			`SELECT u.id, u.first_name, u.last_name, gm.role
			 FROM group_memberships gm
			 JOIN users u ON u.id = gm.user_id
			 WHERE gm.group_id = $1 AND gm.departed_at IS NULL
			 ORDER BY gm.joined_group_at ASC`,
			[groupId]
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch group members", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns all active accounts the user has a membership on (owner, joint, or
// authorized_user). These are the accounts the user personally holds — not
// scoped to group visibility, so this always reflects the user's full picture
// regardless of what they've chosen to share with their group.
export const getMyDashboardAccounts = async (userId: number): Promise<DashboardAccount[]> => {
	try {
		const res = await pool.query(
			`SELECT a.id, a.account_name, a.type, a.subtype, a.institution_name,
			        a.last_four, a.balance_current, a.balance_available, (a.plaid_account_id IS NULL) AS is_manual
			 FROM accounts a
			 JOIN account_members am ON a.id = am.account_id
			 WHERE am.user_id = $1
			   AND am.ownership_type IN ('owner', 'joint', 'authorized_user')
			   AND a.is_active = true
			 ORDER BY a.id`,
			[userId]
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch user accounts", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns all active accounts that have been shared with the group via
// account_group_visibility. Includes owner identity fields so the frontend
// can show which member each account belongs to in a household view.
// Uses LEFT JOINs on account_members/users so accounts without an 'owner'
// membership row still appear rather than being silently dropped.
export const getGroupDashboardAccounts = async (groupId: number): Promise<DashboardGroupAccount[]> => {
	try {
		const res = await pool.query(
			`SELECT a.id, a.account_name, a.type, a.subtype, a.institution_name,
			        a.last_four, a.balance_current, a.balance_available, (a.plaid_account_id IS NULL) AS is_manual,
			        am.user_id AS owner_id,
			        u.first_name AS owner_first_name,
			        u.last_name AS owner_last_name
			 FROM accounts a
			 JOIN account_group_visibility agv ON agv.account_id = a.id
			 LEFT JOIN account_members am ON am.account_id = a.id AND am.ownership_type = 'owner'
			 LEFT JOIN users u ON u.id = am.user_id
			 WHERE agv.group_id = $1
			   AND a.is_active = true
			 ORDER BY am.user_id NULLS LAST, a.id`,
			[groupId]
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch group accounts", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns the N most recent transactions for the user, ordered newest-first.
// Used for the "recent activity" preview on the dashboard summary — not paginated.
// Unlike getMyTransactionsPaged, this does not include owner identity fields
// since all transactions here trivially belong to the requesting user.
export const getMyDashboardTransactions = async (
	userId: number,
	limit = 30
): Promise<DashboardTransaction[]> => {
	try {
		const res = await pool.query(
			`SELECT t.id, t.transaction_date, t.amount, t.description, t.category,
			        t.merchant_name, t.entry_method, akt.account_id, a.account_name, a.institution_name, a.last_four
			 FROM transactions t
			 JOIN account_transactions akt ON t.id = akt.transaction_id
			 JOIN accounts a ON akt.account_id = a.id
			 WHERE t.user_id = $1
			 ORDER BY t.transaction_date DESC, t.id DESC
			 LIMIT $2`,
			[userId, limit]
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch user transactions", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns the N most recent transactions across all accounts shared with the group,
// ordered newest-first. Includes owner identity fields so the frontend can attribute
// each transaction to a member in a household feed. Used for the summary preview —
// not paginated (use getGroupTransactionsPaged for the full transaction list).
export const getGroupDashboardTransactions = async (
	groupId: number,
	limit = 50
): Promise<DashboardGroupTransaction[]> => {
	try {
		const res = await pool.query(
			`SELECT t.id, t.transaction_date, t.amount, t.description, t.category,
			        t.merchant_name, t.entry_method, akt.account_id, a.account_name, a.institution_name, a.last_four,
			        t.user_id AS owner_id,
			        u.first_name AS owner_first_name,
			        u.last_name AS owner_last_name
			 FROM transactions t
			 JOIN account_transactions akt ON t.id = akt.transaction_id
			 JOIN accounts a ON akt.account_id = a.id
			 JOIN account_group_visibility agv ON agv.account_id = a.id
			 JOIN users u ON u.id = t.user_id
			 WHERE agv.group_id = $1
			 ORDER BY t.transaction_date DESC, t.id DESC
			 LIMIT $2`,
			[groupId, limit]
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch group transactions", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns the full income vs. spending history for a single user, grouped by
// calendar month and ordered oldest-to-newest for charting. The frontend slices
// this to the selected timeframe (1M…5Y/all time), so the full history is
// returned rather than a fixed rolling window.
// Income = positive amounts (deposits, refunds), spending = absolute value of
// negative amounts (purchases, withdrawals) — matches the sign convention in
// the transactions table (positive = inflow, negative = outflow).
// Months with no transactions are omitted rather than returned as zero rows.
export const getUserDashboardMonthly = async (userId: number): Promise<DashboardMonthly[]> => {
	try {
		const res = await pool.query(
			`SELECT
			   TO_CHAR(DATE_TRUNC('month', t.transaction_date), 'Mon YYYY') AS month,
			   DATE_TRUNC('month', t.transaction_date) AS month_start,
			   COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::float AS income,
			   COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0)::float AS spending
			 FROM transactions t
			 WHERE t.user_id = $1
			 GROUP BY month_start, 1
			 ORDER BY month_start`,
			[userId]
		);
		return res.rows.map((r) => ({
			month: r.month as string,
			income: r.income as number,
			spending: r.spending as number,
		}));
	} catch (e) {
		throw new DatabaseError("Failed to fetch user monthly data", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Same full income vs. spending history as getUserDashboardMonthly, but
// aggregated across all accounts shared with the group via account_group_visibility.
// Reflects the household's combined financial picture, not any single member's.
export const getGroupDashboardMonthly = async (groupId: number): Promise<DashboardMonthly[]> => {
	try {
		const res = await pool.query(
			`SELECT
			   TO_CHAR(DATE_TRUNC('month', t.transaction_date), 'Mon YYYY') AS month,
			   DATE_TRUNC('month', t.transaction_date) AS month_start,
			   COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::float AS income,
			   COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0)::float AS spending
			 FROM transactions t
			 JOIN account_transactions akt ON t.id = akt.transaction_id
			 JOIN account_group_visibility agv ON agv.account_id = akt.account_id
			 WHERE agv.group_id = $1
			 GROUP BY month_start, 1
			 ORDER BY month_start`,
			[groupId]
		);
		return res.rows.map((r) => ({
			month: r.month as string,
			income: r.income as number,
			spending: r.spending as number,
		}));
	} catch (e) {
		throw new DatabaseError("Failed to fetch group monthly data", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Returns a per-month spending-by-category breakdown for a single user across
// the full transaction history (the same months as getUserDashboardMonthly, so
// the 'Mon YYYY' labels line up). Only outflow transactions (amount < 0) are
// counted; amounts are stored as absolute values for display, and null
// categories are bucketed under "Other". The frontend sums the rows whose month
// falls inside the selected timeframe to build the pie chart — there is no
// top-N cap here because the bounded Plaid category set keeps the row count
// small (a handful of categories per month).
export const getUserDashboardCategories = async (userId: number): Promise<DashboardMonthlyCategory[]> => {
	try {
		const res = await pool.query(
			`SELECT
			   TO_CHAR(DATE_TRUNC('month', t.transaction_date), 'Mon YYYY') AS month,
			   DATE_TRUNC('month', t.transaction_date) AS month_start,
			   COALESCE(t.category, 'Other') AS category,
			   SUM(ABS(t.amount))::float AS total
			 FROM transactions t
			 WHERE t.user_id = $1
			   AND t.amount < 0
			 GROUP BY DATE_TRUNC('month', t.transaction_date), COALESCE(t.category, 'Other')
			 ORDER BY month_start, total DESC`,
			[userId]
		);
		return res.rows.map((r) => ({
			month: r.month as string,
			category: r.category as string,
			total: r.total as number,
		}));
	} catch (e) {
		throw new DatabaseError("Failed to fetch user categories", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Same per-month spending-by-category breakdown as getUserDashboardCategories, but
// aggregated across all accounts shared with the group via account_group_visibility.
// Gives a household-level view of where money is being spent, month by month.
export const getGroupDashboardCategories = async (groupId: number): Promise<DashboardMonthlyCategory[]> => {
	try {
		const res = await pool.query(
			`SELECT
			   TO_CHAR(DATE_TRUNC('month', t.transaction_date), 'Mon YYYY') AS month,
			   DATE_TRUNC('month', t.transaction_date) AS month_start,
			   COALESCE(t.category, 'Other') AS category,
			   SUM(ABS(t.amount))::float AS total
			 FROM transactions t
			 JOIN account_transactions akt ON t.id = akt.transaction_id
			 JOIN account_group_visibility agv ON agv.account_id = akt.account_id
			 WHERE agv.group_id = $1
			   AND t.amount < 0
			 GROUP BY DATE_TRUNC('month', t.transaction_date), COALESCE(t.category, 'Other')
			 ORDER BY month_start, total DESC`,
			[groupId]
		);
		return res.rows.map((r) => ({
			month: r.month as string,
			category: r.category as string,
			total: r.total as number,
		}));
	} catch (e) {
		throw new DatabaseError("Failed to fetch group categories", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Builds a monthly net-worth time series from per-account balance snapshots.
// `scopeCte` is a SELECT that yields the in-view accounts as (id, type); the
// three public functions below differ only in that scope (the user's accounts,
// the group's shared accounts, or one member's group-shared accounts).
//
// Semantics: for each month from the first recorded snapshot through the current
// month, take each account's latest snapshot on-or-before that month's end
// (last-observation carry-forward, so an account that didn't update in a given
// month keeps its prior balance rather than dropping to zero), then sum assets
// minus liabilities — credit/loan balances subtract. If there are no snapshots
// in scope, the bounds CTE yields NULL and generate_series returns no rows, so
// the series is simply empty.
const netWorthSeriesQuery = (scopeCte: string): string => `
	WITH scope AS (${scopeCte}),
	bounds AS (
		SELECT date_trunc('month', MIN(s.snapshot_date)) AS first_month
		FROM account_balance_snapshots s
		JOIN scope ON scope.id = s.account_id
	),
	months AS (
		SELECT generate_series(
			(SELECT first_month FROM bounds),
			date_trunc('month', NOW()),
			interval '1 month'
		) AS month_start
	),
	per AS (
		SELECT m.month_start, sc.type,
			(SELECT s.balance FROM account_balance_snapshots s
			  WHERE s.account_id = sc.id
			    AND s.snapshot_date < m.month_start + interval '1 month'
			  ORDER BY s.snapshot_date DESC LIMIT 1) AS bal
		FROM months m CROSS JOIN scope sc
	)
	SELECT TO_CHAR(month_start, 'Mon YYYY') AS month,
		COALESCE(SUM(CASE WHEN type IN ('credit', 'loan')
			THEN -COALESCE(bal, 0) ELSE COALESCE(bal, 0) END), 0)::float AS net_worth
	FROM per
	GROUP BY month_start
	ORDER BY month_start`;

const mapNetWorthRows = (rows: { month: string; net_worth: number }[]): DashboardNetWorth[] =>
	rows.map((r) => ({ month: r.month as string, net_worth: r.net_worth as number }));

// Net-worth series scoped to every account the user personally holds (owner,
// joint, or authorized_user) — the same scope as getMyDashboardAccounts.
export const getUserNetWorthSeries = async (userId: number): Promise<DashboardNetWorth[]> => {
	try {
		const res = await pool.query(
			netWorthSeriesQuery(`
				SELECT a.id, a.type FROM accounts a
				JOIN account_members am ON am.account_id = a.id
				WHERE am.user_id = $1
				  AND am.ownership_type IN ('owner', 'joint', 'authorized_user')
				  AND a.is_active = true`),
			[userId]
		);
		return mapNetWorthRows(res.rows);
	} catch (e) {
		throw new DatabaseError("Failed to fetch user net worth", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Net-worth series across all accounts shared with the group via
// account_group_visibility — the household's combined picture.
export const getGroupNetWorthSeries = async (groupId: number): Promise<DashboardNetWorth[]> => {
	try {
		const res = await pool.query(
			netWorthSeriesQuery(`
				SELECT a.id, a.type FROM accounts a
				JOIN account_group_visibility agv ON agv.account_id = a.id
				WHERE agv.group_id = $1
				  AND a.is_active = true`),
			[groupId]
		);
		return mapNetWorthRows(res.rows);
	} catch (e) {
		throw new DatabaseError("Failed to fetch group net worth", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
