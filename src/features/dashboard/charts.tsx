import { useMemo, useState } from "react";
import {
	Area,
	Bar,
	BarChart as RBarChart,
	CartesianGrid,
	Cell,
	ComposedChart,
	Pie,
	PieChart as RPieChart,
	ResponsiveContainer,
	Sector,
	Tooltip,
	XAxis,
	YAxis,
	type PieSectorShapeProps,
	type TooltipContentProps,
} from "recharts";
import { fmt, type Category, type Month, type NetWorthPoint } from "./data";

// Recharts paints series via SVG presentation attributes (fill/stroke), where
// CSS var() does NOT resolve — so series colors are concrete oklch() literals
// mirroring the design tokens in dashboard.css / design.css. Axis text, grid
// lines and the legend are styled in CSS (see dashboard.css) so they stay
// theme-aware. Keep these in sync with the CSS tokens.
const COLOR = {
	income: "oklch(0.65 0.20 211)", // --brand (blue)
	spending: "oklch(0.66 0.18 35)", // --cat-3 (orange)
	saved: "oklch(0.70 0.17 152)", // green — net positive
	overspent: "oklch(0.62 0.18 25)", // --danger (red) — net negative
} as const;

// Category token → concrete color, mirroring the --cat-* tokens.
const CAT_COLOR: Record<string, string> = {
	"cat-1": "oklch(0.62 0.18 211)",
	"cat-2": "oklch(0.72 0.16 165)",
	"cat-3": "oklch(0.66 0.18 35)",
	"cat-4": "oklch(0.70 0.14 295)",
	"cat-5": "oklch(0.65 0.18 22)",
	"cat-6": "oklch(0.74 0.12 90)",
};

const AXIS_TICK = { fontSize: 11, fontFamily: "var(--font-mono)", fill: "var(--ink-4)" };

function yAxisTick(v: number): string {
	const abs = Math.abs(v);
	if (abs >= 1000) return `$${(v / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
	return `$${v}`;
}

function ChartEmpty({ label }: { label: string }) {
	return <div className="chart-empty">{label}</div>;
}

// ============================================================
// Shared tooltip — one dark card listing each series row.
// ============================================================
type TipRow = { label: string; value: number; color: string; signed?: boolean };

function TipCard({ title, rows }: { title: string; rows: TipRow[] }) {
	return (
		<div className="rc-tip">
			<div className="rc-tip-title">{title}</div>
			{rows.map((r) => (
				<div className="rc-tip-row" key={r.label}>
					<span className="rc-tip-dot" style={{ background: r.color }} />
					<span className="rc-tip-label">{r.label}</span>
					<span className="rc-tip-val mono">
						{fmt(r.value, { signed: r.signed, cents: true })}
					</span>
				</div>
			))}
		</div>
	);
}

// ============================================================
// Net worth over time — single area line
// ============================================================
export function NetWorthChart({ points }: { points: NetWorthPoint[] }) {
	const data = useMemo(
		() => points.map((p) => ({ month: p.m, netWorth: p.netWorth })),
		[points]
	);

	if (data.length === 0)
		return <ChartEmpty label="Net worth history will appear as it's tracked." />;

	const tooltip = (p: TooltipContentProps) => {
		if (!p.active || !p.payload?.length) return null;
		const nw = Number(p.payload[0].value ?? 0);
		return (
			<TipCard
				title={String(p.label)}
				rows={[{ label: "Net worth", value: nw, color: COLOR.income }]}
			/>
		);
	};

	return (
		<div className="chart-wrap">
			<ResponsiveContainer width="100%" height={280}>
				<ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 4 }}>
					<defs>
						<linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={COLOR.income} stopOpacity={0.18} />
							<stop offset="100%" stopColor={COLOR.income} stopOpacity={0} />
						</linearGradient>
					</defs>
					<CartesianGrid vertical={false} strokeDasharray="0" className="rc-grid" />
					<XAxis dataKey="month" tickLine={false} axisLine={false} tick={AXIS_TICK} dy={6} />
					<YAxis
						width={48}
						tickLine={false}
						axisLine={false}
						tick={AXIS_TICK}
						tickFormatter={yAxisTick}
					/>
					<Tooltip content={tooltip} cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }} />
					<Area
						name="Net worth"
						type="monotone"
						dataKey="netWorth"
						stroke={COLOR.income}
						strokeWidth={2.2}
						fill="url(#nwFill)"
						activeDot={{ r: 4 }}
					/>
				</ComposedChart>
			</ResponsiveContainer>
		</div>
	);
}

// A single donut sector, rendered via Recharts' per-sector `shape` render prop
// so we can drive the emphasis from our own hover/click state (the built-in
// activeShape/activeIndex props are deprecated in Recharts 3). The active slice
// grows outward and gains a detached outer ring; the rest dim back so the
// selection reads clearly. `shape` receives the fully-computed geometry
// (center, radii, padded angles) so we never do any angle math ourselves.
function PieSlice(props: PieSectorShapeProps & { activeIndex: number | null }) {
	const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, index, activeIndex } =
		props;
	const isActive = index === activeIndex;
	const isDim = activeIndex != null && !isActive;
	const outer = Number(outerRadius ?? 0);
	return (
		<g className="pie-slice" opacity={isDim ? 0.4 : 1}>
			<Sector
				cx={cx}
				cy={cy}
				innerRadius={innerRadius}
				outerRadius={isActive ? outer + 6 : outer}
				startAngle={startAngle}
				endAngle={endAngle}
				fill={fill}
				stroke="var(--surface)"
				strokeWidth={2}
			/>
			{isActive ? (
				<Sector
					cx={cx}
					cy={cy}
					innerRadius={outer + 9}
					outerRadius={outer + 11}
					startAngle={startAngle}
					endAngle={endAngle}
					fill={fill}
					opacity={0.45}
				/>
			) : null}
		</g>
	);
}

// ============================================================
// Spending by category — donut for the current period
// ============================================================
export function PieChart({ categories }: { categories: Category[] }) {
	const data = useMemo(
		() =>
			categories.map((c) => ({
				name: c.name,
				value: c.v,
				color: CAT_COLOR[c.c] ?? COLOR.income,
			})),
		[categories]
	);
	const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

	// Hover wins while the cursor is over a slice/legend row; otherwise the last
	// clicked slice stays selected so its breakdown lingers in the center.
	const [hovered, setHovered] = useState<number | null>(null);
	const [selected, setSelected] = useState<number | null>(null);
	const active = hovered ?? selected;

	if (data.length === 0 || total === 0)
		return <ChartEmpty label="No spending to break down yet." />;

	const activeSlice = active != null ? data[active] : null;
	const toggle = (i: number) => setSelected((s) => (s === i ? null : i));

	return (
		<div className="pie-wrap">
			<div className="pie-canvas">
				<ResponsiveContainer width="100%" height={260}>
					<RPieChart>
						<Pie
							data={data}
							dataKey="value"
							nameKey="name"
							cx="50%"
							cy="50%"
							innerRadius={62}
							outerRadius={94}
							paddingAngle={1.5}
							isAnimationActive={false}
							shape={(p: PieSectorShapeProps) => <PieSlice {...p} activeIndex={active} />}
							onMouseEnter={(_, i) => setHovered(i)}
							onMouseLeave={() => setHovered(null)}
							onClick={(_, i) => toggle(i)}
						>
							{data.map((d) => (
								<Cell key={d.name} fill={d.color} />
							))}
						</Pie>
					</RPieChart>
				</ResponsiveContainer>

				{/* Center readout — total by default, the active slice on hover/select. */}
				<div className="pie-center" aria-hidden>
					{activeSlice ? (
						<>
							<span className="pie-center-cap">{activeSlice.name}</span>
							<span className="pie-center-v mono">
								{fmt(activeSlice.value, { cents: true })}
							</span>
							<span className="pie-center-pct mono">
								{((activeSlice.value / total) * 100).toFixed(1)}%
							</span>
						</>
					) : (
						<>
							<span className="pie-center-cap">Total</span>
							<span className="pie-center-v mono">{fmt(total, { cents: true })}</span>
							<span className="pie-center-sub">
								{data.length} {data.length === 1 ? "category" : "categories"}
							</span>
						</>
					)}
				</div>
			</div>

			<ul className="pie-legend">
				<li className="pie-legend-total">
					<span className="pie-legend-name">Total spending</span>
					<span className="pie-legend-v mono">{fmt(total, { cents: true })}</span>
				</li>
				{data.map((d, i) => (
					<li
						key={d.name}
						className={`${active === i ? "active" : ""} ${active != null && active !== i ? "dim" : ""}`}
						onMouseEnter={() => setHovered(i)}
						onMouseLeave={() => setHovered(null)}
						onClick={() => toggle(i)}
					>
						<span className="legend-dot" style={{ background: d.color }} />
						<span className="pie-legend-name">{d.name}</span>
						<span className="pie-legend-pct mono">
							{((d.value / total) * 100).toFixed(1)}%
						</span>
						<span className="pie-legend-v mono">{fmt(d.value, { cents: true })}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

// ============================================================
// Made vs Spent per month — grouped bars (income beside spending)
// ============================================================
export function BarChart({ months }: { months: Month[] }) {
	const data = useMemo(
		() => months.map((m) => ({ month: m.m, income: m.inc, spending: m.spend })),
		[months]
	);

	if (data.length === 0) return <ChartEmpty label="No activity in this period." />;

	const tooltip = (p: TooltipContentProps) => {
		if (!p.active || !p.payload?.length) return null;
		const inc = Number(p.payload.find((d) => d.dataKey === "income")?.value ?? 0);
		const spend = Number(p.payload.find((d) => d.dataKey === "spending")?.value ?? 0);
		return (
			<TipCard
				title={String(p.label)}
				rows={[
					{ label: "Made", value: inc, color: COLOR.income },
					{ label: "Spent", value: spend, color: COLOR.spending },
					{ label: "Net", value: inc - spend, color: COLOR.saved, signed: true },
				]}
			/>
		);
	};

	return (
		<div className="chart-wrap">
			<ResponsiveContainer width="100%" height={280}>
				<RBarChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 4 }}>
					<CartesianGrid vertical={false} className="rc-grid" />
					<XAxis dataKey="month" tickLine={false} axisLine={false} tick={AXIS_TICK} dy={6} />
					<YAxis
						width={48}
						tickLine={false}
						axisLine={false}
						tick={AXIS_TICK}
						tickFormatter={yAxisTick}
					/>
					<Tooltip content={tooltip} cursor={{ fill: "var(--surface-2)" }} />
					{/* Two series with no stackId render grouped side by side. */}
					<Bar name="Made" dataKey="income" fill={COLOR.income} radius={[3, 3, 3, 3]} maxBarSize={28} />
					<Bar name="Spent" dataKey="spending" fill={COLOR.spending} radius={[3, 3, 3, 3]} maxBarSize={28} />
				</RBarChart>
			</ResponsiveContainer>

			<div className="chart-legend">
				<span className="legend-item">
					<span className="legend-dot" style={{ background: COLOR.income }} /> Made
				</span>
				<span className="legend-item">
					<span className="legend-dot" style={{ background: COLOR.spending }} /> Spent
				</span>
			</div>
		</div>
	);
}
