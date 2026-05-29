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
	n: string;
	t: string;
	bal: number;
	mask: string;
	tone: string;
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
	const raw = bal ?? 0;
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
	// Append time to avoid UTC-to-local shift on date-only strings
	const d = new Date(isoDate + "T12:00:00");
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
		return {
			d: formatTxDate(t.transaction_date),
			name: t.merchant_name || t.description || "Unknown",
			cat: t.category || "Other",
			amt: t.amount,
			acct,
			positive: t.amount > 0,
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
			n: a.account_name,
			t: `${cap(a.subtype ?? a.type)} · ${a.owner_first_name}`,
			bal: effectiveBal(a.balance_current, a.type),
			mask: a.last_four ? `••${a.last_four}` : "—",
			tone: accountTone(a.type, a.subtype),
		}));
	}

	if (viewKey === "me") {
		return summary.my_accounts.map((a) => ({
			n: a.account_name,
			t: cap(a.subtype ?? a.type),
			bal: effectiveBal(a.balance_current, a.type),
			mask: a.last_four ? `••${a.last_four}` : "—",
			tone: accountTone(a.type, a.subtype),
		}));
	}

	const memberId = parseInt(viewKey.replace("member-", ""), 10);
	return summary.group_accounts
		.filter((a) => a.owner_id === memberId)
		.map((a) => ({
			n: a.account_name,
			t: cap(a.subtype ?? a.type),
			bal: effectiveBal(a.balance_current, a.type),
			mask: a.last_four ? `••${a.last_four}` : "—",
			tone: accountTone(a.type, a.subtype),
		}));
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
