import type { DashboardSummary } from "../../lib/api";

export type Month = { m: string; inc: number; spend: number };

export type Category = { name: string; v: number; c: string };

export type Transaction = {
	d: string;
	name: string;
	cat: string;
	amt: number;
	acct: string;
	positive?: boolean;
	who?: string;
};

export type View = {
	name: string;
	role: string;
	months: Month[];
	categories: Category[];
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

export type RangeKey = "1M" | "3M" | "6M" | "1Y";

export const RANGES: Record<RangeKey, { months: number; label: string }> = {
	"1M": { months: 1, label: "Last month" },
	"3M": { months: 3, label: "Last 3 months" },
	"6M": { months: 6, label: "Last 6 months" },
	"1Y": { months: 12, label: "Last 12 months" },
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
		inc: m.income,
		spend: m.spending,
	}));
}

function buildCategories(categories: Array<{ category: string; total: number }>): Category[] {
	return categories.map((c, i) => ({
		name: c.category,
		v: c.total,
		c: CAT_COLORS[i % CAT_COLORS.length],
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
		};
	});
}

export function buildDashboardView(summary: DashboardSummary, viewKey: string): View {
	if (viewKey === "group") {
		return {
			name: summary.group?.name ?? "Household",
			role: "Group",
			months: buildMonths(summary.group_monthly),
			categories: buildCategories(summary.group_categories),
			tx: buildTransactions(summary.group_transactions, true),
		};
	}

	if (viewKey === "me") {
		const u = summary.user;
		return {
			name: `${u.first_name} ${u.last_name}`,
			role: "You",
			months: buildMonths(summary.my_monthly),
			categories: buildCategories(summary.my_categories),
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
		categories: buildCategories(member?.categories ?? []),
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
