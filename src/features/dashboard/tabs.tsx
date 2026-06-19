import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { buildTransactions, fmt, formatTxDate, groupAccountsByType, RANGES, sliceCategories, slicePriorMonths, type AccountDisplay, type AccountTypeGroup, type RangeKey, type Slice, type Transaction, type View, type ViewKey } from "./data";
import { MonthCards, NetWorthChart, PieChart } from "./charts";
import { ModalShell } from "./modals";
import { AddAccountModal, ManualAccountForm, type EditingAccount } from "./AddAccountModal";
import { AddTransactionModal, type EditingTransaction } from "./AddTransactionModal";
import type { ManualAccountType } from "./accountTaxonomy";
import { IconBank, IconCard, IconLoan, IconInvest } from "../../components/icons";
import { api, ApiError, type AccountMember, type DashboardSummary, type RecurringStream, type TxPageFilter, type TransactionPageSummary, type TxRange, type TxMonthlyBucket } from "../../lib/api";

type ChartKind = "line" | "pie";

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
	sub: ReactNode;
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

// Human labels for Plaid's recurring-stream frequency enum.
const FREQ_LABELS: Record<string, string> = {
	WEEKLY: "Weekly",
	BIWEEKLY: "Every 2 weeks",
	SEMI_MONTHLY: "Twice a month",
	MONTHLY: "Monthly",
	ANNUALLY: "Yearly",
	UNKNOWN: "Recurring",
};

// Approximate charges per month by frequency, for the panel's monthly-cost
// headline (13 weeks ≈ 3 months keeps the weekly factors exact-ish).
const FREQ_PER_MONTH: Record<string, number> = {
	WEEKLY: 13 / 3,
	BIWEEKLY: 13 / 6,
	SEMI_MONTHLY: 2,
	MONTHLY: 1,
	ANNUALLY: 1 / 12,
	UNKNOWN: 1,
};

// "Mar 2024" — for the "since …" copy in a subscription's all-time detail.
function formatMonthYear(isoDate: string): string {
	const d = new Date((isoDate ?? "").slice(0, 10) + "T12:00:00");
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function SubscriptionRow({ s }: { s: RecurringStream }) {
	// Click pins the all-time detail open; hover shows the same total as a tooltip.
	const [open, setOpen] = useState(false);
	const name = s.merchant_name || s.description;
	const amount = s.average_amount ?? s.last_amount ?? 0;
	const freq = FREQ_LABELS[s.frequency] ?? "Recurring";

	return (
		<li className="sub-li">
			<button
				type="button"
				className="tx-li tx-li-btn"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				aria-label={`${name} — show all-time spend`}
			>
				<span className={`tx-tag ${txTagClass(name)}`}>{name[0]?.toUpperCase()}</span>
				<div className="tx-li-meta">
					<div className="tx-li-name">{name}</div>
					<div className="tx-li-sub">
						<span>{freq}</span>
						{s.predicted_next_date ? (
							<>
								<span className="dot-sep">·</span>
								<span>Next {formatTxDate(s.predicted_next_date)}</span>
							</>
						) : null}
						{s.account_name ? (
							<>
								<span className="dot-sep">·</span>
								<span>{s.account_name}</span>
							</>
						) : null}
					</div>
				</div>
				<div className="tx-li-amt mono">{fmt(amount, { cents: true })}</div>
			</button>
			<span className="sub-tip mono" role="tooltip">
				{fmt(s.total_spent, { cents: true })} all time
			</span>
			{open ? (
				<div className="sub-detail">
					You’ve spent{" "}
					<strong className="mono">{fmt(s.total_spent, { cents: true })}</strong> on{" "}
					{name} all time — {s.charge_count}{" "}
					{s.charge_count === 1 ? "charge" : "charges"} since{" "}
					{formatMonthYear(s.first_date)}.
				</div>
			) : null}
		</li>
	);
}

// Recurring outflow streams (subscriptions, bills) detected by Plaid from the
// cadence of past transactions — see GET /plaid/recurring. Inflow streams
// (payroll etc.) are excluded server-side; this panel is about recurring spend.
function SubscriptionsPanel({ view, name }: { view: ViewKey; name: string }) {
	const [streams, setStreams] = useState<RecurringStream[]>([]);
	const [loading, setLoading] = useState(true);
	const [fetchError, setFetchError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setFetchError(null);
		api
			.getRecurringStreams(view)
			.then((data) => {
				if (cancelled) return;
				setStreams(data.streams);
				// Per-item failures (one dead bank link) still return the other
				// banks' streams — surface them in the console, not the panel.
				if (data.errors.length > 0) {
					console.warn("[SubscriptionsPanel] partial fetch", data.errors);
				}
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("[SubscriptionsPanel] fetch failed", err);
				setFetchError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => { if (!cancelled) setLoading(false); });

		return () => { cancelled = true; };
	}, [view]);

	// Normalize every stream to a per-month cost for the headline estimate.
	const monthlyTotal = streams.reduce(
		(sum, s) =>
			sum +
			(s.average_amount ?? s.last_amount ?? 0) * (FREQ_PER_MONTH[s.frequency] ?? 1),
		0
	);

	return (
		<section className="panel">
			<div className="panel-head">
				<div>
					<h2 className="panel-h">Subscriptions</h2>
					<p className="panel-sub">
						{loading || streams.length === 0
							? `Recurring charges for ${name}`
							: `${streams.length} recurring · ≈ ${fmt(monthlyTotal)}/mo`}
					</p>
				</div>
			</div>
			{loading ? (
				<div className="tx-loading">Loading…</div>
			) : fetchError ? (
				<div className="tx-loading" style={{ color: "oklch(0.55 0.18 25)" }}>
					Failed to load: {fetchError}
				</div>
			) : streams.length === 0 ? (
				<div className="tx-empty">No recurring charges detected yet.</div>
			) : (
				<ul className="tx-list">
					{streams.slice(0, 15).map((s) => (
						<SubscriptionRow key={s.stream_id} s={s} />
					))}
				</ul>
			)}
		</section>
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
	const hasIncome = slice.inc > 0;
	const savingsRate = hasIncome ? (slice.savings / slice.inc) * 100 : 0;
	// A savings *rate* only communicates anything while spending is within 2×
	// income; past that (or with no income at all) the ratio explodes into
	// numbers like −1900% — show "—" and let the sub-copy tell the real story.
	const rateMeaningful = hasIncome && savingsRate >= -100;
	// Headline when the rate degenerates: how many times over income the
	// spending ran ("20× spent") — the multiple stays readable where the
	// percentage would explode.
	const spendMultiple = hasIncome ? slice.spend / slice.inc : 0;
	// Baseline for the savings-rate KPI: the user's own rate over the window
	// immediately before this one — a data-derived comparison rather than an
	// arbitrary fixed target (revisit once budgets exist). Null when there's no
	// prior window (ALL range, or history shorter than the range) or the prior
	// window's rate is itself degenerate.
	const prior = useMemo(() => slicePriorMonths(v, range), [v, range]);
	const priorRate = prior && prior.inc > 0 ? (prior.savings / prior.inc) * 100 : null;
	const rateDelta =
		priorRate === null || priorRate < -100 ? null : savingsRate - priorRate;
	// "Last 3 months" → "3 months", for "vs prior 3 months" copy.
	const periodLabel = RANGES[range].label.toLowerCase().replace(/^last /, "");
	const monthsLen = slice.months.length || 1;
	// Spending-by-category rolled up to the selected timeframe, in lock-step with
	// the line/bar charts (same months as the slice). Drives the pie and the
	// category-based insights below.
	const categories = useMemo(
		() => sliceCategories(v.categoriesByMonth, slice.months),
		[v.categoriesByMonth, slice.months]
	);
	// Net-worth points sliced to the active timeframe — daily granularity, so
	// this slices by days rather than months.
	const netWorthSlice = useMemo(
		() => v.netWorth.slice(-RANGES[range].days),
		[v.netWorth, range]
	);
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
					value={
						rateMeaningful
							? `${savingsRate.toFixed(1)}%`
							: !hasIncome
							? "—"
							: `${spendMultiple >= 10 ? spendMultiple.toFixed(0) : spendMultiple.toFixed(1)}× spent`
					}
					sub={
						!hasIncome ? (
							slice.spend > 0 ? (
								<>
									Spent <span className="neg mono">{fmt(slice.spend)}</span> · no
									income recorded
								</>
							) : (
								"No activity this period"
							)
						) : !rateMeaningful ? (
							<>
								Spent <span className="neg mono">{fmt(slice.spend)}</span> vs{" "}
								<span className="pos mono">{fmt(slice.inc)}</span> earned
							</>
						) : savingsRate < 0 ? (
							"Spent more than earned"
						) : rateDelta === null ? (
							"Share of income kept"
						) : Math.abs(rateDelta) < 0.5 ? (
							`About even with prior ${periodLabel}`
						) : (
							`${rateDelta > 0 ? "Up" : "Down"} ${Math.abs(rateDelta).toFixed(1)} pts vs prior ${periodLabel}`
						)
					}
					accent={
						!hasIncome
							? slice.spend > 0
								? "neg"
								: null
							: savingsRate < 0
							? "neg"
							: rateDelta === null
							? null
							: rateDelta >= 0
							? "pos"
							: "warn"
					}
				/>
			</div>

			{/* Income vs spent for the last 4 calendar months — intentionally
			    outside the timeframe selector's reach (always the same window),
			    a fixed quick read on whether spending is outpacing income. */}
			<MonthCards months={v.months} key={`mc-${view}`} />

			<section className="panel chart-panel">
				<div className="panel-head">
					<div>
						<h2 className="panel-h">Activity</h2>
						<p className="panel-sub">
							{chart === "line" ? "Net worth over time." : null}
							{chart === "pie" ? "Where your money went, by category." : null}
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

				<SubscriptionsPanel view={view} name={v.name} />
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

// Empty KPI aggregates — the initial state and the fallback when a response omits
// `summary` (e.g. an older backend during a deploy skew).
const ZERO_SUMMARY: TransactionPageSummary = {
	total: 0,
	sumIn: 0,
	sumOut: 0,
	countIn: 0,
	countOut: 0,
};

// Timeframe options for the transaction list, narrowest first. Labels stay short
// so the segmented control fits beside the income/spend filter.
const TX_TIMEFRAMES: { key: TxRange; label: string }[] = [
	{ key: "month", label: "This month" },
	{ key: "3m", label: "3M" },
	{ key: "6m", label: "6M" },
	{ key: "1y", label: "1Y" },
	{ key: "all", label: "All" },
];

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
	// "" means all categories; any other value narrows to that exact category.
	const [category, setCategory] = useState("");
	const [categories, setCategories] = useState<string[]>([]);
	// Free-text search over merchant/description. `searchInput` is bound to the box
	// (immediate); `search` is the debounced value that actually drives the fetch.
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	// Timeframe lower bound — defaults to the current month so the list opens
	// focused instead of as an all-time stream.
	const [range, setRange] = useState<TxRange>("month");
	const [page, setPage] = useState(1);
	const [txs, setTxs] = useState<Transaction[]>([]);
	const [total, setTotal] = useState(0);
	const [pages, setPages] = useState(1);
	// Per-month totals for the section headers (true month totals over the whole
	// filtered set, server-computed — never a sum of the current page).
	const [monthly, setMonthly] = useState<TxMonthlyBucket[]>([]);
	// Full-set KPI aggregates (every matching transaction, all pages) — the
	// summary cards must not be derived from the current page alone.
	const [summary, setSummary] = useState<TransactionPageSummary>(ZERO_SUMMARY);
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
		if (isViewChange) {
			setPage(1);
			// A category/search from the previous view may not apply to the new one;
			// reset them so the controls and fetch stay consistent.
			setCategory("");
			setSearchInput("");
			setSearch("");
		}
		const effectiveCategory = isViewChange ? "" : category;
		const effectiveSearch = isViewChange ? "" : search;

		setLoading(true);
		setFetchError(null);
		api
			.getTransactionPage(view, effectivePage, "all", effectiveCategory || undefined, range, effectiveSearch || undefined)
			.then((data) => {
				if (cancelled) return;
				setTxs(buildTransactions(data.transactions, data.showOwner));
				setTotal(data.total);
				setPages(data.pages);
				// Default if absent so a response shape from an older backend (during a
				// deploy skew) degrades gracefully instead of crashing the page.
				setSummary(data.summary ?? ZERO_SUMMARY);
				setMonthly(data.monthly ?? []);
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("[TabTransactions] fetch failed", err);
				setFetchError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => { if (!cancelled) setLoading(false); });

		return () => { cancelled = true; };
	}, [view, page, category, range, search, reloadKey]);

	// Debounce the search box so we fire one request after typing settles, not one
	// per keystroke. Committing a new term resets to the first page.
	useEffect(() => {
		const id = setTimeout(() => {
			const v = searchInput.trim();
			if (v !== search) {
				setSearch(v);
				setPage(1);
			}
		}, 300);
		return () => clearTimeout(id);
	}, [searchInput, search]);

	// Load the distinct category list whenever the view changes — it scopes the
	// dropdown options to categories that actually exist for the active view.
	useEffect(() => {
		let cancelled = false;
		api
			.getTransactionCategories(view)
			.then((data) => {
				if (!cancelled) setCategories(data.categories);
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("[TabTransactions] category fetch failed", err);
				setCategories([]);
			});
		return () => { cancelled = true; };
	}, [view]);

	const handleCategory = (c: string) => {
		setCategory(c);
		setPage(1);
	};

	const handleRange = (r: TxRange) => {
		setRange(r);
		setPage(1);
	};

	// Group the current page's rows into contiguous month sections (rows arrive
	// newest-first, so a month's rows are already adjacent). Each section's header
	// total is looked up from the server's per-month breakdown by monthKey, so it
	// reflects the month's true totals regardless of which rows are on this page.
	const monthlyByKey = useMemo(() => {
		const m = new Map<string, TxMonthlyBucket>();
		for (const b of monthly ?? []) m.set(b.monthKey, b);
		return m;
	}, [monthly]);

	const sections = useMemo(() => {
		const out: { key: string; rows: Transaction[] }[] = [];
		for (const t of txs) {
			const key = t.dateISO.slice(0, 7); // YYYY-MM
			const last = out[out.length - 1];
			if (last && last.key === key) last.rows.push(t);
			else out.push({ key, rows: [t] });
		}
		return out;
	}, [txs]);

	return (
		<div className="db-content" key={view}>
			<div className="kpi-strip">
				<KPI
					label="Money in"
					value={fmt(summary.sumIn, { cents: true })}
					sub={`${summary.countIn.toLocaleString()} transactions`}
					accent="pos"
				/>
				<KPI
					label="Money out"
					value={fmt(summary.sumOut, { cents: true })}
					sub={`${summary.countOut.toLocaleString()} transactions`}
					accent="neg"
				/>
				<KPI
					label="Net"
					value={fmt(summary.sumIn - summary.sumOut, { signed: true, cents: true })}
					sub="All transactions"
				/>
				<KPI
					label="Total"
					value={total.toLocaleString()}
					sub={
						search
							? "matching transactions"
							: category
							? `${category} transactions`
							: "transactions"
					}
				/>
			</div>

			<section className="panel">
				<div className="panel-head">
					<div>
						<h2 className="panel-h">All transactions</h2>
						<p className="panel-sub">
							{TX_TIMEFRAMES.find((tf) => tf.key === range)?.label} · {total.toLocaleString()} total · page {page} of {pages}
						</p>
					</div>
					<div className="panel-controls">
						<input
							className="tx-search"
							type="search"
							placeholder="Search transactions…"
							value={searchInput}
							onChange={(e) => setSearchInput(e.target.value)}
							aria-label="Search transactions"
						/>
						<div className="seg seg-range" role="tablist" aria-label="Timeframe">
							{TX_TIMEFRAMES.map((tf) => (
								<button
									key={tf.key}
									role="tab"
									aria-selected={range === tf.key}
									className={`seg-btn seg-btn-sm ${range === tf.key ? "active" : ""}`}
									onClick={() => handleRange(tf.key)}
								>
									{tf.label}
								</button>
							))}
						</div>
						<select
							className="tx-cat-select"
							value={category}
							onChange={(e) => handleCategory(e.target.value)}
							aria-label="Filter by category"
						>
							<option value="">All categories</option>
							{categories.map((c) => (
								<option key={c} value={c}>
									{c}
								</option>
							))}
						</select>
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
				) : txs.length === 0 ? (
					<ul className="tx-list">
						<li className="tx-empty">No transactions found.</li>
					</ul>
				) : (
					sections.map((s) => {
						const bucket = monthlyByKey.get(s.key);
						return (
							<div className="tx-section" key={s.key}>
								<div className="tx-month-head">
									<span className="tx-month-label">{bucket?.month ?? s.key}</span>
									{bucket ? (
										<span className="tx-month-net">
											<span className="tx-month-spent mono">
												{fmt(bucket.sumOut, { cents: true })}
											</span>
											{" spent"}
										</span>
									) : null}
								</div>
								<ul className="tx-list">
									{s.rows.map((t, i) => (
										<TxRow key={i} t={t} onEdit={setEditingTx} />
									))}
								</ul>
							</div>
						);
					})
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
											<div className="acct-name">
												{a.n}
												{a.isJoint ? <span className="tag tag-sm">Joint</span> : null}
												{a.isPrivate ? (
													<span className="tag tag-sm tag-muted">Private</span>
												) : null}
											</div>
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

// Owner/joint controls for a single account: household visibility (public vs
// private), the user-declared "joint" flag, and co-owner management (link/unlink
// an existing household member as a full joint holder — the de-dup path that
// avoids a second Plaid link of the same account).
function AccountSettings({
	account,
	members,
	onChanged,
}: {
	account: DashboardSummary["my_accounts"][number];
	members: DashboardSummary["members"];
	onChanged: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [isPrivate, setIsPrivate] = useState(account.is_private);
	const [isJoint, setIsJoint] = useState(account.is_joint_declared);
	const [coOwners, setCoOwners] = useState<AccountMember[] | null>(null);
	const [addId, setAddId] = useState<number | "">("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	// Lazily load the account's holders the first time the section is opened.
	useEffect(() => {
		if (!open || coOwners != null) return;
		let cancelled = false;
		api
			.getAccountMembers(account.id)
			.then((d) => { if (!cancelled) setCoOwners(d.members); })
			.catch(() => { if (!cancelled) setCoOwners([]); });
		return () => { cancelled = true; };
	}, [open, coOwners, account.id]);

	const run = async (fn: () => Promise<void>) => {
		setError("");
		setBusy(true);
		try {
			await fn();
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	};

	const setVisibility = (priv: boolean) =>
		void run(async () => {
			await api.setAccountVisibility(account.id, priv ? "private" : "group");
			setIsPrivate(priv);
			onChanged();
		});

	const toggleJoint = () =>
		void run(async () => {
			await api.markAccountJoint(account.id, !isJoint);
			setIsJoint(!isJoint);
			onChanged();
		});

	const refreshMembers = async () => {
		const d = await api.getAccountMembers(account.id);
		setCoOwners(d.members);
	};

	const addCoOwner = () =>
		void run(async () => {
			if (addId === "") return;
			await api.addCoOwner(account.id, Number(addId));
			setAddId("");
			await refreshMembers();
			onChanged();
		});

	const removeCoOwner = (userId: number) =>
		void run(async () => {
			await api.removeCoOwner(account.id, userId);
			await refreshMembers();
			onChanged();
		});

	// Household members not already holders of this account — candidates to link.
	const heldIds = new Set((coOwners ?? []).map((m) => m.user_id));
	const linkable = members.filter((m) => !heldIds.has(m.id));
	const canManageCoOwners = members.length > 1;

	return (
		<div className="acct-settings">
			<button className="acct-settings-toggle" onClick={() => setOpen((o) => !o)}>
				<span>Account settings</span>
				<span className="acct-settings-tags">
					{isPrivate ? <span className="tag tag-muted">Private</span> : null}
					{isJoint ? <span className="tag">Joint</span> : null}
					<span className="acct-settings-caret">{open ? "▲" : "▼"}</span>
				</span>
			</button>

			{open ? (
				<div className="acct-settings-body">
					<div className="acct-settings-row">
						<div className="acct-settings-l">
							<div className="acct-settings-h">Visibility</div>
							<div className="acct-settings-d">
								{isPrivate
									? "Only you can see this account."
									: "Everyone in your household can see this account."}
							</div>
						</div>
						<div className="seg">
							<button
								className={`seg-btn ${!isPrivate ? "active" : ""}`}
								disabled={busy}
								onClick={() => setVisibility(false)}
							>
								Household
							</button>
							<button
								className={`seg-btn ${isPrivate ? "active" : ""}`}
								disabled={busy}
								onClick={() => setVisibility(true)}
							>
								Private
							</button>
						</div>
					</div>

					<div className="acct-settings-row">
						<div className="acct-settings-l">
							<div className="acct-settings-h">Joint account</div>
							<div className="acct-settings-d">
								Flag this as shared with another person.
							</div>
						</div>
						<button
							className={`chip ${isJoint ? "chip-on" : ""}`}
							disabled={busy}
							onClick={toggleJoint}
						>
							{isJoint ? "Joint" : "Mark joint"}
						</button>
					</div>

					{canManageCoOwners ? (
						<div className="acct-settings-row acct-settings-coowners">
							<div className="acct-settings-l">
								<div className="acct-settings-h">Co-owners</div>
								<div className="acct-settings-d">
									Linked members see this account on their own dashboard. It still
									counts once for the household.
								</div>
								<ul className="acct-coowner-list">
									{(coOwners ?? []).map((m) => (
										<li key={m.user_id} className="acct-coowner">
											<span>
												{m.first_name} {m.last_name}
												<span className="acct-coowner-role"> · {m.ownership_type}</span>
											</span>
											{m.ownership_type !== "owner" ? (
												<button
													className="link-btn"
													disabled={busy}
													onClick={() => removeCoOwner(m.user_id)}
												>
													Remove
												</button>
											) : null}
										</li>
									))}
								</ul>
								{linkable.length > 0 ? (
									<div className="acct-coowner-add">
										<select
											className="input"
											value={addId}
											onChange={(e) =>
												setAddId(e.target.value === "" ? "" : Number(e.target.value))
											}
										>
											<option value="">Link a household member…</option>
											{linkable.map((m) => (
												<option key={m.id} value={m.id}>
													{m.first_name} {m.last_name}
												</option>
											))}
										</select>
										<button
											className="btn btn-sm btn-brand"
											disabled={busy || addId === ""}
											onClick={addCoOwner}
										>
											Link
										</button>
									</div>
								) : null}
							</div>
						</div>
					) : null}

					{error ? <div className="field-error">{error}</div> : null}
				</div>
			) : null}
		</div>
	);
}

function AccountTransactionsModal({
	account,
	accounts,
	members,
	onClose,
	onChanged,
}: {
	account: AccountDisplay;
	accounts: DashboardSummary["my_accounts"];
	members: DashboardSummary["members"];
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
				{ownRaw ? (
					<AccountSettings
						account={ownRaw}
						members={members}
						onChanged={onChanged}
					/>
				) : null}

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
	members,
	onAccountAdded,
}: {
	v: View;
	view: ViewKey;
	accounts: AccountDisplay[];
	myAccounts: DashboardSummary["my_accounts"];
	members: DashboardSummary["members"];
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
					members={members}
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
