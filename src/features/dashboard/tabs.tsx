import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { buildTransactions, fmt, groupAccountsByType, RANGES, sliceCategories, type AccountDisplay, type AccountTypeGroup, type RangeKey, type Slice, type Transaction, type View, type ViewKey } from "./data";
import { BarChart, NetWorthChart, PieChart } from "./charts";
import { ModalShell } from "./modals";
import { AddAccountModal, ManualAccountForm, type EditingAccount } from "./AddAccountModal";
import { AddTransactionModal, type EditingTransaction } from "./AddTransactionModal";
import type { ManualAccountType } from "./accountTaxonomy";
import { IconBank, IconCard, IconLoan, IconInvest } from "../../components/icons";
import { api, ApiError, type DashboardSummary, type TxPageFilter } from "../../lib/api";

type ChartKind = "line" | "pie" | "bar";

// Icon per Plaid top-level account type, shown beside each account-type group so
// the category reads at a glance. Falls back to the bank icon for any unmapped type.
const TYPE_ICONS: Record<string, (p: { size?: number }) => ReactElement> = {
	depository: IconBank,
	credit: IconCard,
	loan: IconLoan,
	investment: IconInvest,
};

type Accent = "pos" | "neg" | "warn" | null;

function KPI({
	label,
	value,
	sub,
	accent,
}: {
	label: string;
	value: string;
	sub: string;
	accent?: Accent;
}) {
	return (
		<div className={`kpi ${accent || ""}`}>
			<div className="kpi-l">{label}</div>
			<div className="kpi-v mono">{value}</div>
			<div className="kpi-sub">{sub}</div>
		</div>
	);
}

function Insight({
	tone,
	title,
	body,
}: {
	tone: "pos" | "neg" | "warn" | "info";
	title: string;
	body: string;
}) {
	return (
		<li className={`insight insight-${tone}`}>
			<span className="insight-dot" />
			<div>
				<div className="insight-t">{title}</div>
				<div className="insight-b">{body}</div>
			</div>
		</li>
	);
}

function SegIconLine() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M2 11l3-4 3 2 6-6" />
		</svg>
	);
}

function SegIconPie() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M8 2v6l5 3.2" />
			<circle cx="8" cy="8" r="6" />
		</svg>
	);
}

function SegIconBar() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="2" y="9" width="3" height="5" rx="0.5" />
			<rect x="6.5" y="5" width="3" height="9" rx="0.5" />
			<rect x="11" y="7" width="3" height="7" rx="0.5" />
		</svg>
	);
}

function txTagClass(cat: string): string {
	const ch = (cat[0] || "X").toUpperCase().charCodeAt(0);
	return `tx-${(ch % 6) + 1}`;
}

export function DashboardTab({
	v,
	slice,
	range,
	setRange,
	view,
	onViewAllTransactions,
}: {
	v: View;
	slice: Slice;
	range: RangeKey;
	setRange: (r: RangeKey) => void;
	view: ViewKey;
	onViewAllTransactions: () => void;
}) {
	const [chart, setChart] = useState<ChartKind>("line");
	const savingsRate = slice.inc > 0 ? (slice.savings / slice.inc) * 100 : 0;
	const monthsLen = slice.months.length || 1;
	// Spending-by-category rolled up to the selected timeframe, in lock-step with
	// the line/bar charts (same months as the slice). Drives the pie and the
	// category-based insights below.
	const categories = useMemo(
		() => sliceCategories(v.categoriesByMonth, slice.months),
		[v.categoriesByMonth, slice.months]
	);
	// Net-worth points sliced to the active timeframe, same as slice.months.
	const netWorthSlice = useMemo(
		() => v.netWorth.slice(-RANGES[range].months),
		[v.netWorth, range]
	);
	const totalCategorySpend = categories.reduce((a, b) => a + b.v, 0) || 1;

	return (
		<div className="db-content">
			<div className="kpi-strip" key={view + range}>
				<KPI
					label="Net cash flow"
					value={fmt(slice.savings, { signed: true })}
					sub={`${RANGES[range].label.toLowerCase()} · ${savingsRate.toFixed(0)}% of income`}
					accent={slice.savings >= 0 ? "pos" : "neg"}
				/>
				<KPI
					label="Income"
					value={fmt(slice.inc)}
					sub={`Across ${monthsLen} mo · ${fmt(Math.round(slice.inc / monthsLen))} avg`}
				/>
				<KPI
					label="Spending"
					value={fmt(slice.spend)}
					sub={`${fmt(Math.round(slice.spend / monthsLen))} avg / mo`}
				/>
				<KPI
					label="Savings rate"
					value={`${savingsRate.toFixed(1)}%`}
					sub={savingsRate >= 20 ? "On pace · keep it up" : "Below 20% target"}
					accent={savingsRate >= 20 ? "pos" : "warn"}
				/>
			</div>

			<section className="panel chart-panel">
				<div className="panel-head">
					<div>
						<h2 className="panel-h">Activity</h2>
						<p className="panel-sub">
							{chart === "line" ? "Net worth over time." : null}
							{chart === "pie" ? "Where your money went, by category." : null}
							{chart === "bar"
								? "Income vs spending each month — made beside spent."
								: null}
						</p>
					</div>
					<div className="panel-controls">
						<div className="seg seg-chart" role="tablist" aria-label="Chart type">
							<button
								role="tab"
								aria-selected={chart === "line"}
								className={`seg-btn ${chart === "line" ? "active" : ""}`}
								onClick={() => setChart("line")}
							>
								<SegIconLine /> <span>Net worth</span>
							</button>
							<button
								role="tab"
								aria-selected={chart === "pie"}
								className={`seg-btn ${chart === "pie" ? "active" : ""}`}
								onClick={() => setChart("pie")}
							>
								<SegIconPie /> <span>Pie</span>
							</button>
							<button
								role="tab"
								aria-selected={chart === "bar"}
								className={`seg-btn ${chart === "bar" ? "active" : ""}`}
								onClick={() => setChart("bar")}
							>
								<SegIconBar /> <span>Bars</span>
							</button>
						</div>
						<div className="seg seg-range" role="tablist" aria-label="Timeframe">
							{(Object.keys(RANGES) as RangeKey[]).map((r) => (
								<button
									key={r}
									role="tab"
									aria-selected={range === r}
									className={`seg-btn seg-btn-sm ${range === r ? "active" : ""}`}
									onClick={() => setRange(r)}
								>
									{r === "ALL" ? "All" : r}
								</button>
							))}
						</div>
					</div>
				</div>

				<div className="chart-stage" key={chart + view + range}>
					{chart === "line" ? <NetWorthChart points={netWorthSlice} /> : null}
					{chart === "pie" ? <PieChart categories={categories} /> : null}
					{chart === "bar" ? <BarChart months={slice.months} /> : null}
				</div>
			</section>

			<div className="db-row-2">
				<section className="panel">
					<div className="panel-head">
						<div>
							<h2 className="panel-h">Recent transactions</h2>
							<p className="panel-sub">
								{view === "group" ? "All household members" : v.name}
							</p>
						</div>
						<button className="link-btn" onClick={onViewAllTransactions}>
							View all →
						</button>
					</div>
					<ul className="tx-list">
						{v.tx.slice(0, 15).map((t, i) => (
							<TxRow key={i} t={t} />
						))}
					</ul>
				</section>

				<section className="panel">
					<div className="panel-head">
						<div>
							<h2 className="panel-h">Insights</h2>
							<p className="panel-sub">Auto-generated for {v.name}</p>
						</div>
					</div>
					<ul className="insight-list">
						<Insight
							tone="pos"
							title="Spending dropped 12% this month"
							body={`You spent ${fmt(Math.floor(slice.spend / monthsLen))} on average — below your 6-month baseline.`}
						/>
						<Insight
							tone="info"
							title={`Top category: ${categories[0]?.name ?? "—"}`}
							body={`${fmt(categories[0]?.v ?? 0)} in ${RANGES[range].label.toLowerCase()}, ${(((categories[0]?.v ?? 0) / totalCategorySpend) * 100).toFixed(0)}% of all spending.`}
						/>
						<Insight
							tone={savingsRate >= 20 ? "pos" : "warn"}
							title={savingsRate >= 20 ? "Savings rate on track" : "Savings rate below target"}
							body={`Currently ${savingsRate.toFixed(1)}%. Most households aim for 20% or more.`}
						/>
						<Insight
							tone="info"
							title="3 subscriptions due this week"
							body="Apple, Spotify, and NYT auto-renew between Apr 30 and May 3."
						/>
					</ul>
				</section>
			</div>
		</div>
	);
}

function TxRow({
	t,
	onEdit,
}: {
	t: Transaction;
	onEdit?: (t: Transaction) => void;
}) {
	const content = (
		<>
			<span className={`tx-tag ${txTagClass(t.cat)}`}>{t.cat[0]}</span>
			<div className="tx-li-meta">
				<div className="tx-li-name">{t.name}</div>
				<div className="tx-li-sub">
					<span>{t.cat}</span>
					<span className="dot-sep">·</span>
					<span>{t.acct}</span>
					<span className="dot-sep">·</span>
					<span>{t.d}</span>
				</div>
			</div>
			<div className={`tx-li-amt mono ${t.positive ? "pos" : ""}`}>
				{fmt(t.amt, { signed: true, cents: true })}
			</div>
		</>
	);

	// Only manual transactions are editable — clicking opens the editor.
	if (onEdit && t.editable) {
		return (
			<li>
				<button
					type="button"
					className="tx-li tx-li-btn"
					onClick={() => onEdit(t)}
					aria-label={`Edit ${t.name}`}
				>
					{content}
				</button>
			</li>
		);
	}

	return <li className="tx-li">{content}</li>;
}

export function TabTransactions({
	view,
	accounts,
	onTransactionAdded,
}: {
	v: View;
	view: ViewKey;
	accounts: DashboardSummary["my_accounts"];
	onTransactionAdded: () => void;
}) {
	const [filter, setFilter] = useState<TxPageFilter>("all");
	const [page, setPage] = useState(1);
	const [txs, setTxs] = useState<Transaction[]>([]);
	const [total, setTotal] = useState(0);
	const [pages, setPages] = useState(1);
	const [loading, setLoading] = useState(true);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [addingTx, setAddingTx] = useState(false);
	const [editingTx, setEditingTx] = useState<Transaction | null>(null);
	// Bumped after a manual add/edit/delete to re-run the fetch for the current page.
	const [reloadKey, setReloadKey] = useState(0);

	const handleSaved = () => {
		setReloadKey((k) => k + 1);
		onTransactionAdded();
	};

	const editingPayload: EditingTransaction | undefined = editingTx
		? {
				id: editingTx.id,
				vendor: editingTx.name,
				amount: editingTx.amt,
				category: editingTx.categoryRaw,
				accountId: editingTx.accountId,
				dateISO: editingTx.dateISO,
		  }
		: undefined;
	const prevViewRef = useRef(view);

	useEffect(() => {
		let cancelled = false;
		const isViewChange = prevViewRef.current !== view;
		prevViewRef.current = view;
		const effectivePage = isViewChange ? 1 : page;
		if (isViewChange) setPage(1);

		setLoading(true);
		setFetchError(null);
		api
			.getTransactionPage(view, effectivePage, filter)
			.then((data) => {
				if (cancelled) return;
				setTxs(buildTransactions(data.transactions, data.showOwner));
				setTotal(data.total);
				setPages(data.pages);
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("[TabTransactions] fetch failed", err);
				setFetchError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => { if (!cancelled) setLoading(false); });

		return () => { cancelled = true; };
	}, [view, page, filter, reloadKey]);

	const handleFilter = (f: TxPageFilter) => {
		setFilter(f);
		setPage(1);
	};

	const totalIn = useMemo(() => txs.filter((t) => t.positive).reduce((s, t) => s + t.amt, 0), [txs]);
	const totalOut = useMemo(() => txs.filter((t) => !t.positive).reduce((s, t) => s + Math.abs(t.amt), 0), [txs]);

	return (
		<div className="db-content" key={view}>
			<div className="kpi-strip">
				<KPI
					label="Money in"
					value={fmt(totalIn, { cents: true })}
					sub={`${txs.filter((t) => t.positive).length} on this page`}
					accent="pos"
				/>
				<KPI
					label="Money out"
					value={fmt(totalOut, { cents: true })}
					sub={`${txs.filter((t) => !t.positive).length} on this page`}
					accent="neg"
				/>
				<KPI
					label="Net"
					value={fmt(totalIn - totalOut, { signed: true, cents: true })}
					sub="This page"
				/>
				<KPI
					label="Total"
					value={total.toLocaleString()}
					sub={filter === "all" ? "transactions" : `${filter} transactions`}
				/>
			</div>

			<section className="panel">
				<div className="panel-head">
					<div>
						<h2 className="panel-h">All transactions</h2>
						<p className="panel-sub">
							Page {page} of {pages} · {total.toLocaleString()} total
						</p>
					</div>
					<div className="panel-controls">
						<div className="seg">
							<button
								className={`seg-btn ${filter === "all" ? "active" : ""}`}
								onClick={() => handleFilter("all")}
							>
								All
							</button>
							<button
								className={`seg-btn ${filter === "income" ? "active" : ""}`}
								onClick={() => handleFilter("income")}
							>
								Income
							</button>
							<button
								className={`seg-btn ${filter === "spend" ? "active" : ""}`}
								onClick={() => handleFilter("spend")}
							>
								Spending
							</button>
						</div>
						<button
							className="btn btn-sm btn-brand"
							onClick={() => setAddingTx(true)}
						>
							+ Add transaction
						</button>
					</div>
				</div>

				{loading ? (
					<div className="tx-loading">Loading…</div>
				) : fetchError ? (
					<div className="tx-loading" style={{ color: "oklch(0.55 0.18 25)" }}>
						Failed to load: {fetchError}
					</div>
				) : (
					<ul className="tx-list">
						{txs.map((t, i) => (
							<TxRow key={i} t={t} onEdit={setEditingTx} />
						))}
						{txs.length === 0 ? (
							<li className="tx-empty">No transactions found.</li>
						) : null}
					</ul>
				)}

				{pages > 1 ? (
					<div className="tx-pagination">
						<button
							className="btn btn-sm btn-ghost"
							onClick={() => setPage((p) => p - 1)}
							disabled={page <= 1 || loading}
						>
							← Prev
						</button>
						<span className="tx-page-label">
							{page} / {pages}
						</span>
						<button
							className="btn btn-sm btn-ghost"
							onClick={() => setPage((p) => p + 1)}
							disabled={page >= pages || loading}
						>
							Next →
						</button>
					</div>
				) : null}
			</section>

			{addingTx ? (
				<AddTransactionModal
					accounts={accounts}
					onClose={() => setAddingTx(false)}
					onSaved={handleSaved}
				/>
			) : null}

			{editingTx ? (
				<AddTransactionModal
					accounts={accounts}
					editing={editingPayload}
					onClose={() => setEditingTx(null)}
					onSaved={handleSaved}
				/>
			) : null}
		</div>
	);
}


function formatSyncTime(iso: string | null): string {
	if (!iso) return "Never synced";
	return (
		"Last synced at " +
		new Date(iso).toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		})
	);
}

function Chevron() {
	return (
		<svg
			className="acct-group-chevron"
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M4 6l4 4 4-4" />
		</svg>
	);
}

function ChevronRight() {
	return (
		<svg
			className="acct-li-chevron"
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M6 4l4 4-4 4" />
		</svg>
	);
}

function AccountGroup({
	group,
	defaultOpen,
	onSelect,
}: {
	group: AccountTypeGroup;
	defaultOpen: boolean;
	onSelect: (a: AccountDisplay) => void;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const panelId = `acct-group-${group.type}`;
	const showSubLabels = group.subgroups.length > 1;
	const TypeIcon = TYPE_ICONS[group.type] ?? IconBank;

	return (
		<div className={`acct-group ${open ? "open" : ""}`}>
			<button
				type="button"
				className="acct-group-head"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((o) => !o)}
			>
				<span className="acct-group-mark" style={{ color: `var(--${group.tone})` }}>
					<TypeIcon size={18} />
				</span>
				<div className="acct-group-title">
					<span className="acct-group-label">{group.label}</span>
					<span className="acct-group-count">
						{group.count} {group.count === 1 ? "account" : "accounts"}
					</span>
				</div>
				<span className={`acct-group-total mono ${group.total < 0 ? "neg" : ""}`}>
					{fmt(group.total, { cents: true })}
				</span>
				<Chevron />
			</button>

			<div className="acct-group-body" id={panelId} hidden={!open}>
				{group.subgroups.map((sg) => (
					<div key={sg.subtype} className="acct-subgroup">
						{showSubLabels ? (
							<div className="acct-subgroup-head">
								<span className="acct-subgroup-label">{sg.subtype}</span>
								<span className="acct-subgroup-total mono">
									{fmt(sg.total, { cents: true })}
								</span>
							</div>
						) : null}
						<ul className="acct-list">
							{sg.accounts.map((a) => (
								<li key={a.id}>
									<button
										type="button"
										className="acct-li acct-li-btn"
										onClick={() => onSelect(a)}
										aria-label={`View transactions for ${a.n}`}
									>
										<span className="acct-mark" style={{ background: `var(--${a.tone})` }}>
											{a.n[0]}
										</span>
										<div className="acct-meta">
											<div className="acct-name">{a.n}</div>
											<div className="acct-sub">
												{a.t} · {a.mask}
											</div>
										</div>
										<div className={`acct-bal mono ${a.bal < 0 ? "neg" : ""}`}>
											{fmt(a.bal, { cents: true })}
										</div>
										<ChevronRight />
									</button>
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</div>
	);
}

function AccountTransactionsModal({
	account,
	accounts,
	onClose,
	onChanged,
}: {
	account: AccountDisplay;
	accounts: DashboardSummary["my_accounts"];
	onClose: () => void;
	onChanged: () => void;
}) {
	const [filter, setFilter] = useState<TxPageFilter>("all");
	const [page, setPage] = useState(1);
	const [txs, setTxs] = useState<Transaction[]>([]);
	const [total, setTotal] = useState(0);
	const [pages, setPages] = useState(1);
	const [loading, setLoading] = useState(true);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [editingTx, setEditingTx] = useState<Transaction | null>(null);
	const [editingAccount, setEditingAccount] = useState(false);
	// Bumped after an edit/delete to re-run the fetch for the current page.
	const [reloadKey, setReloadKey] = useState(0);

	// The user can manage any account they personally own — look up the raw record
	// from their own accounts. Manual accounts are fully editable; Plaid accounts
	// open read-only (details are managed by Plaid) with removal as the only action.
	const ownRaw = accounts.find((a) => a.id === account.id);
	const accountEditable = ownRaw != null;
	const accountReadOnly = ownRaw != null && !ownRaw.is_manual;
	const editingAccountPayload: EditingAccount | undefined = ownRaw
		? {
				id: ownRaw.id,
				account_name: ownRaw.account_name,
				type: ownRaw.type as ManualAccountType,
				subtype: ownRaw.subtype,
				institution_name: ownRaw.institution_name,
				last_four: ownRaw.last_four,
				balance_current: ownRaw.balance_current,
		  }
		: undefined;

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setFetchError(null);
		api
			.getAccountTransactionPage(account.id, page, filter)
			.then((data) => {
				if (cancelled) return;
				setTxs(buildTransactions(data.transactions, false));
				setTotal(data.total);
				setPages(data.pages);
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("[AccountTransactionsModal] fetch failed", err);
				setFetchError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => { if (!cancelled) setLoading(false); });

		return () => { cancelled = true; };
	}, [account.id, page, filter, reloadKey]);

	const handleFilter = (f: TxPageFilter) => {
		setFilter(f);
		setPage(1);
	};

	// Refresh both this account's transaction list and the parent dashboard
	// (its totals/categories) after a manual transaction changes.
	const handleSaved = () => {
		setReloadKey((k) => k + 1);
		onChanged();
	};

	const editingPayload: EditingTransaction | undefined = editingTx
		? {
				id: editingTx.id,
				vendor: editingTx.name,
				amount: editingTx.amt,
				category: editingTx.categoryRaw,
				accountId: editingTx.accountId,
				dateISO: editingTx.dateISO,
		  }
		: undefined;

	return (
		<ModalShell
			title={account.n}
			sub={`${account.t} · ${account.mask} · ${fmt(account.bal, { cents: true })} · ${total.toLocaleString()} transactions`}
			onClose={onClose}
			width={620}
			headerAction={
				accountEditable ? (
					<button
						className="btn btn-sm"
						onClick={() => setEditingAccount(true)}
					>
						Edit
					</button>
				) : undefined
			}
		>
			<div className="acct-tx-modal">
				<div className="seg acct-tx-filter">
					<button
						className={`seg-btn ${filter === "all" ? "active" : ""}`}
						onClick={() => handleFilter("all")}
					>
						All
					</button>
					<button
						className={`seg-btn ${filter === "income" ? "active" : ""}`}
						onClick={() => handleFilter("income")}
					>
						Income
					</button>
					<button
						className={`seg-btn ${filter === "spend" ? "active" : ""}`}
						onClick={() => handleFilter("spend")}
					>
						Spending
					</button>
				</div>

				{loading ? (
					<div className="tx-loading">Loading…</div>
				) : fetchError ? (
					<div className="tx-loading" style={{ color: "oklch(0.55 0.18 25)" }}>
						Failed to load: {fetchError}
					</div>
				) : txs.length === 0 ? (
					<div className="tx-empty">No transactions for this account.</div>
				) : (
					<ul className="tx-list">
						{txs.map((t, i) => (
							<TxRow key={i} t={t} onEdit={setEditingTx} />
						))}
					</ul>
				)}

				{pages > 1 ? (
					<div className="tx-pagination">
						<button
							className="btn btn-sm btn-ghost"
							onClick={() => setPage((p) => p - 1)}
							disabled={page <= 1 || loading}
						>
							← Prev
						</button>
						<span className="tx-page-label">
							{page} / {pages}
						</span>
						<button
							className="btn btn-sm btn-ghost"
							onClick={() => setPage((p) => p + 1)}
							disabled={page >= pages || loading}
						>
							Next →
						</button>
					</div>
				) : null}
			</div>

			{editingTx ? (
				<AddTransactionModal
					accounts={accounts}
					editing={editingPayload}
					onClose={() => setEditingTx(null)}
					onSaved={handleSaved}
				/>
			) : null}

			{editingAccount && editingAccountPayload ? (
				<ManualAccountForm
					editing={editingAccountPayload}
					readOnly={accountReadOnly}
					onClose={() => setEditingAccount(false)}
					onSaved={() => {
						// Refresh the dashboard, then close the account modal so the
						// (now stale) header is replaced by the refreshed accounts list.
						onChanged();
						onClose();
					}}
					onDeleted={() => {
						// The account no longer exists — refresh the dashboard and close
						// the account modal entirely.
						onChanged();
						onClose();
					}}
				/>
			) : null}
		</ModalShell>
	);
}

export function TabAccounts({
	v,
	view,
	accounts,
	myAccounts,
	onAccountAdded,
}: {
	v: View;
	view: ViewKey;
	accounts: AccountDisplay[];
	myAccounts: DashboardSummary["my_accounts"];
	onAccountAdded: () => void;
}) {
	const accts = accounts;
	const groups = useMemo(() => groupAccountsByType(accts), [accts]);
	const [selected, setSelected] = useState<AccountDisplay | null>(null);
	const [addingAccount, setAddingAccount] = useState(false);

	const total = accts.reduce((a, b) => a + b.bal, 0);
	const cash = accts.filter((a) => a.type === "depository").reduce((s, a) => s + a.bal, 0);
	const inv = accts.filter((a) => a.type === "investment").reduce((s, a) => s + a.bal, 0);
	const debt = accts
		.filter((a) => a.type === "credit" || a.type === "loan")
		.reduce((s, a) => s + a.bal, 0);

	const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
	const [isSyncing, setIsSyncing] = useState(false);

	useEffect(() => {
		api.getSyncStatus()
			.then((d) => {
				setLastSyncedAt(d.last_synced_at);
				setIsSyncing(d.is_syncing);
			})
			.catch(() => {});
	}, []);

	const handleSync = async () => {
		setIsSyncing(true);
		try {
			const result = await api.triggerSync();
			setLastSyncedAt(result.last_synced_at);
		} catch (e) {
			if (!(e instanceof ApiError && e.status === 409)) throw e;
		} finally {
			setIsSyncing(false);
		}
	};

	return (
		<div className="db-content" key={view}>
			<div className="kpi-strip">
				<KPI
					label="Net worth"
					value={fmt(total)}
					sub={`${accts.length} accounts`}
					accent="pos"
				/>
				<KPI label="Cash" value={fmt(cash)} sub="Liquid assets" />
				<KPI label="Investments" value={fmt(inv)} sub="Brokerage + retirement" />
				<KPI
					label="Liabilities"
					value={fmt(debt)}
					sub="Credit cards + loans"
					accent={debt < 0 ? "neg" : null}
				/>
			</div>
			<section className="panel">
				<div className="panel-head">
					<div>
						<h2 className="panel-h">Connected accounts</h2>
						<p className="panel-sub">
							{v.name} · read-only · {formatSyncTime(lastSyncedAt)}
						</p>
					</div>
					<div className="panel-controls">
						<button
							className="btn btn-sm"
							onClick={handleSync}
							disabled={isSyncing}
						>
							{isSyncing ? "Syncing…" : "Sync now"}
						</button>
						<button
							className="btn btn-sm btn-brand"
							onClick={() => setAddingAccount(true)}
						>
							+ Add account
						</button>
					</div>
				</div>
				{groups.length === 0 ? (
					<div className="tx-empty">No accounts connected yet.</div>
				) : (
					<div className="acct-groups">
						{groups.map((g, i) => (
							<AccountGroup
								key={g.type}
								group={g}
								defaultOpen={i === 0}
								onSelect={setSelected}
							/>
						))}
					</div>
				)}
			</section>

			{selected ? (
				<AccountTransactionsModal
					account={selected}
					accounts={myAccounts}
					onClose={() => setSelected(null)}
					onChanged={onAccountAdded}
				/>
			) : null}

			{addingAccount ? (
				<AddAccountModal
					onClose={() => setAddingAccount(false)}
					onAdded={onAccountAdded}
				/>
			) : null}
		</div>
	);
}
