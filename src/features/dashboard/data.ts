import type { DashboardSummary } from "../../lib/api";

// `m` is the short label shown on chart axes ("Jun"); `key` is the full
// "Mon YYYY" label used to match a month against the per-month category data
// when slicing the pie to a timeframe (two same-named months from different
// years would otherwise collide).
export type Month = { m: string; key: string; inc: number; spend: number };

export type Category = { name: string; v: number; c: string };

// One net-worth point per month, mirroring Month's `m`/`key` so it slices to a
// timeframe the same way. `netWorth` is assets − liabilities as of that month,
// computed server-side from per-account balance snapshots.
export type NetWorthPoint = { m: string; key: string; netWorth: number };

// One spending-by-category row for a single month ("Mon YYYY"), as returned by
// the dashboard summary over a rolling 12-month window. Aggregated client-side
// into Category[] for whatever timeframe the user selects — see sliceCategories.
export type MonthlyCategory = { month: string; category: string; total: number };

export type Transaction = {
	d: string;
	name: string;
	cat: string;
	amt: number;
	acct: string;
	positive?: boolean;
	who?: string;
	// Edit support — carried through so a manual transaction can be opened in the
	// editor pre-filled. `editable` is true only for manually-entered rows.
	id: number;
	editable: boolean;
	accountId: number;
	dateISO: string;
	categoryRaw: string | null;
};

export type View = {
	name: string;
	role: string;
	months: Month[];
	// Per-month spending-by-category rows for the full 12-month window. The
	// timeframe-specific Category[] for the pie is derived on demand via
	// sliceCategories(view.categoriesByMonth, slice.months).
	categoriesByMonth: MonthlyCategory[];
	// Net-worth-over-time points for the full recorded history; sliced to the
	// active timeframe at render time, like `months`.
	netWorth: NetWorthPoint[];
	tx: Transaction[];
};

export type ViewKey = string;

export type AccountDisplay = {
	id: number;
	n: string;
	t: string;
	bal: number;
	mask: string;
	tone: string;
	type: string;
	subtype: string | null;
};

export type GroupView = {
	k: string;
	name: string;
	sub: string;
	ava: string;
	col: string;
	role: string;
};

export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "5Y" | "ALL";

export const RANGES: Record<RangeKey, { months: number; label: string }> = {
	"1M": { months: 1, label: "Last month" },
	"3M": { months: 3, label: "Last 3 months" },
	"6M": { months: 6, label: "Last 6 months" },
	"1Y": { months: 12, label: "Last 12 months" },
	"5Y": { months: 60, label: "Last 5 years" },
	// All time — slice(-Infinity) clamps to the start and returns every month.
	"ALL": { months: Infinity, label: "All time" },
};

export type Slice = {
	months: Month[];
	inc: number;
	spend: number;
	savings: number;
};

export function sliceMonths(view: View, range: RangeKey): Slice {
	const months = view.months.slice(-RANGES[range].months);
	const inc = months.reduce((a, b) => a + b.inc, 0);
	const spend = months.reduce((a, b) => a + b.spend, 0);
	return { months, inc, spend, savings: inc - spend };
}

// Aggregate the per-month category rows down to a single timeframe-wide
// breakdown for the pie chart, scoped to exactly the months the slice covers so
// the pie stays in lock-step with the line/bar charts. Categories are summed
// across the in-range months and sorted by spend descending. The palette holds
// six colors, so the top five are shown individually and the remaining tail is
// rolled into a single "Other" slice — keeping the pie's total equal to the
// real in-range spend rather than silently dropping the smallest categories.
export function sliceCategories(monthly: MonthlyCategory[], months: Month[]): Category[] {
	const inRange = new Set(months.map((m) => m.key));
	const totals = new Map<string, number>();
	for (const row of monthly) {
		if (!inRange.has(row.month)) continue;
		totals.set(row.category, (totals.get(row.category) ?? 0) + Number(row.total ?? 0));
	}

	const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
	const TOP = CAT_COLORS.length - 1; // reserve the last color for the "Other" roll-up
	const categories: Category[] = ranked.slice(0, TOP).map(([name, v], i) => ({
		name,
		v,
		c: CAT_COLORS[i],
	}));

	const tailTotal = ranked.slice(TOP).reduce((s, [, v]) => s + v, 0);
	if (tailTotal > 0) {
		// The SQL buckets null categories under "Other", so one may already be in
		// the top slice — fold the tail into it rather than emitting a duplicate.
		const existing = categories.find((c) => c.name === "Other");
		if (existing) existing.v += tailTotal;
		else categories.push({ name: "Other", v: tailTotal, c: CAT_COLORS[CAT_COLORS.length - 1] });
	}

	return categories;
}

export function fmt(n: number, opts: { signed?: boolean; cents?: boolean } = {}): string {
	const { signed = false, cents = false } = opts;
	const abs = Math.abs(n);
	const s = abs.toLocaleString("en-US", {
		minimumFractionDigits: cents ? 2 : 0,
		maximumFractionDigits: cents ? 2 : 0,
	});
	if (signed) return (n >= 0 ? "+" : "−") + "$" + s;
	return (n < 0 ? "−" : "") + "$" + s;
}

// ============================================================
// Builder helpers — transform API data into dashboard shapes
// ============================================================

const CAT_COLORS = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;
const AVA_COLORS = ["ava-1", "ava-2", "ava-3", "ava-4"] as const;

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function accountTone(type: string, subtype: string | null): string {
	switch (type) {
		case "depository":
			return subtype === "savings" ? "cat-2" : "cat-1";
		case "investment": return "cat-3";
		case "credit": return "cat-5";
		case "loan": return "cat-6";
		default: return "cat-1";
	}
}

function effectiveBal(bal: number | null, type: string): number {
	// pg returns NUMERIC columns as strings, so coerce before any arithmetic —
	// otherwise summing depository/investment balances concatenates into NaN.
	const raw = Number(bal ?? 0);
	return type === "credit" || type === "loan" ? -raw : raw;
}

function buildMonths(monthly: Array<{ month: string; income: number; spending: number }>): Month[] {
	return monthly.map((m) => ({
		m: m.month.split(" ")[0],
		key: m.month,
		inc: m.income,
		spend: m.spending,
	}));
}

// Convert the server's net-worth series into chart points. Coerce net_worth to a
// number in case pg ever serializes the aggregate as a string.
function buildNetWorth(series: Array<{ month: string; net_worth: number }>): NetWorthPoint[] {
	return series.map((p) => ({
		m: p.month.split(" ")[0],
		key: p.month,
		netWorth: Number(p.net_worth ?? 0),
	}));
}

// Pass the per-month category rows through as-is (coercing totals to numbers, in
// case pg ever serializes NUMERIC as a string). The timeframe roll-up into a
// colored Category[] happens later in sliceCategories, once the active range is
// known.
function buildMonthlyCategories(
	categories: Array<{ month: string; category: string; total: number }>
): MonthlyCategory[] {
	return categories.map((c) => ({
		month: c.month,
		category: c.category,
		total: Number(c.total ?? 0),
	}));
}

function formatTxDate(isoDate: string): string {
	// transaction_date arrives either as a date-only string ("2026-05-30") or, when
	// pg serializes a DATE column through JSON, as a full ISO timestamp
	// ("2026-05-30T05:00:00.000Z"). Take just the leading YYYY-MM-DD and pin it to
	// local noon so the displayed day never shifts across timezones — appending
	// the time to a full ISO string would otherwise produce an Invalid Date.
	const datePart = (isoDate ?? "").slice(0, 10);
	const d = new Date(datePart + "T12:00:00");
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function buildTransactions(
	txs: DashboardSummary["my_transactions"] | DashboardSummary["group_transactions"],
	showOwner: boolean
): Transaction[] {
	return txs.map((t) => {
		const gt = t as DashboardSummary["group_transactions"][number];
		const institution = t.institution_name ?? t.account_name;
		const mask = t.last_four ? ` ••${t.last_four}` : "";
		const acctBase = institution + mask;
		const acct = showOwner && gt.owner_first_name
			? `${gt.owner_first_name} · ${acctBase}`
			: acctBase;
		// pg returns NUMERIC columns as strings, so coerce before any arithmetic —
		// otherwise the KPI reduces (s + t.amt) concatenate strings into "$NaN".
		const amt = Number(t.amount ?? 0);
		return {
			d: formatTxDate(t.transaction_date),
			name: t.merchant_name || t.description || "Unknown",
			cat: t.category || "Other",
			amt,
			acct,
			positive: amt > 0,
			who: showOwner && gt.owner_first_name ? gt.owner_first_name[0] : undefined,
			id: t.id,
			editable: t.entry_method === "manual",
			accountId: t.account_id,
			dateISO: (t.transaction_date ?? "").slice(0, 10),
			categoryRaw: t.category,
		};
	});
}

export function buildDashboardView(summary: DashboardSummary, viewKey: string): View {
	if (viewKey === "group") {
		return {
			name: summary.group?.name ?? "Household",
			role: "Group",
			months: buildMonths(summary.group_monthly),
			categoriesByMonth: buildMonthlyCategories(summary.group_categories),
			netWorth: buildNetWorth(summary.group_net_worth),
			tx: buildTransactions(summary.group_transactions, true),
		};
	}

	if (viewKey === "me") {
		const u = summary.user;
		return {
			name: `${u.first_name} ${u.last_name}`,
			role: "You",
			months: buildMonths(summary.my_monthly),
			categoriesByMonth: buildMonthlyCategories(summary.my_categories),
			netWorth: buildNetWorth(summary.my_net_worth),
			tx: buildTransactions(summary.my_transactions, false),
		};
	}

	// per-member view: key = "member-{id}"
	const memberId = parseInt(viewKey.replace("member-", ""), 10);
	const member = summary.members.find((m) => m.id === memberId);
	const memberTxs = summary.group_transactions.filter((t) => t.owner_id === memberId);

	return {
		name: member ? `${member.first_name} ${member.last_name}` : "Member",
		role: member?.role ? cap(member.role) : "Member",
		months: buildMonths(member?.monthly ?? []),
		categoriesByMonth: buildMonthlyCategories(member?.categories ?? []),
		netWorth: buildNetWorth(member?.net_worth ?? []),
		tx: buildTransactions(memberTxs, false),
	};
}

export function buildAccountsForView(summary: DashboardSummary, viewKey: string): AccountDisplay[] {
	if (viewKey === "group") {
		return summary.group_accounts.map((a) => ({
			id: a.id,
			n: a.account_name,
			t: `${cap(a.subtype ?? a.type)} · ${a.owner_first_name}`,
			bal: effectiveBal(a.balance_current, a.type),
			mask: a.last_four ? `••${a.last_four}` : "—",
			tone: accountTone(a.type, a.subtype),
			type: a.type,
			subtype: a.subtype,
		}));
	}

	if (viewKey === "me") {
		return summary.my_accounts.map((a) => ({
			id: a.id,
			n: a.account_name,
			t: cap(a.subtype ?? a.type),
			bal: effectiveBal(a.balance_current, a.type),
			mask: a.last_four ? `••${a.last_four}` : "—",
			tone: accountTone(a.type, a.subtype),
			type: a.type,
			subtype: a.subtype,
		}));
	}

	const memberId = parseInt(viewKey.replace("member-", ""), 10);
	return summary.group_accounts
		.filter((a) => a.owner_id === memberId)
		.map((a) => ({
			id: a.id,
			n: a.account_name,
			t: cap(a.subtype ?? a.type),
			bal: effectiveBal(a.balance_current, a.type),
			mask: a.last_four ? `••${a.last_four}` : "—",
			tone: accountTone(a.type, a.subtype),
			type: a.type,
			subtype: a.subtype,
		}));
}

// ============================================================
// Account grouping — type → subtype, for the dropdown view
// ============================================================

export type AccountSubGroup = {
	subtype: string;
	accounts: AccountDisplay[];
	total: number;
};

export type AccountTypeGroup = {
	type: string;
	label: string;
	tone: string;
	count: number;
	total: number;
	subgroups: AccountSubGroup[];
};

// Display order + friendly labels for Plaid's four top-level types.
const TYPE_META: Record<string, { label: string; tone: string; order: number }> = {
	depository: { label: "Cash & banking", tone: "cat-1", order: 0 },
	credit: { label: "Credit cards", tone: "cat-5", order: 1 },
	loan: { label: "Loans", tone: "cat-6", order: 2 },
	investment: { label: "Investments", tone: "cat-3", order: 3 },
};

function typeMeta(type: string) {
	return TYPE_META[type] ?? { label: cap(type), tone: "cat-4", order: 99 };
}

/**
 * Organize a flat account list into collapsible groups: one per Plaid
 * top-level type, each holding subgroups keyed by subtype. Groups and
 * subgroups preserve a stable display order; subtypes are sorted A–Z.
 */
export function groupAccountsByType(accounts: AccountDisplay[]): AccountTypeGroup[] {
	const byType = new Map<string, Map<string, AccountDisplay[]>>();

	for (const a of accounts) {
		const subtypeKey = cap(a.subtype ?? a.type);
		if (!byType.has(a.type)) byType.set(a.type, new Map());
		const subs = byType.get(a.type)!;
		if (!subs.has(subtypeKey)) subs.set(subtypeKey, []);
		subs.get(subtypeKey)!.push(a);
	}

	const groups: AccountTypeGroup[] = [];
	for (const [type, subs] of byType) {
		const meta = typeMeta(type);
		const subgroups: AccountSubGroup[] = [...subs.entries()]
			.map(([subtype, accts]) => ({
				subtype,
				accounts: accts,
				total: accts.reduce((s, a) => s + a.bal, 0),
			}))
			.sort((a, b) => a.subtype.localeCompare(b.subtype));

		groups.push({
			type,
			label: meta.label,
			tone: meta.tone,
			count: subgroups.reduce((s, g) => s + g.accounts.length, 0),
			total: subgroups.reduce((s, g) => s + g.total, 0),
			subgroups,
		});
	}

	return groups.sort((a, b) => typeMeta(a.type).order - typeMeta(b.type).order);
}

export function buildGroupViews(summary: DashboardSummary): GroupView[] {
	const views: GroupView[] = [];

	// Only show the household aggregate view when there are multiple members
	if (summary.members.length > 1) {
		views.push({
			k: "group",
			name: summary.group?.name ?? "Household",
			sub: "Everyone",
			ava: (summary.group?.name?.[0] ?? "H").toUpperCase(),
			col: "ava-3",
			role: "Group",
		});
	}

	summary.members.forEach((m, i) => {
		const isMe = m.id === summary.user.id;
		views.push({
			k: isMe ? "me" : `member-${m.id}`,
			name: `${m.first_name} ${m.last_name}`,
			sub: isMe ? "You" : m.role,
			ava: (m.first_name[0] ?? "?").toUpperCase(),
			col: AVA_COLORS[i % AVA_COLORS.length],
			role: m.role,
		});
	});

	return views;
}
