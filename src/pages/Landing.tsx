import { useState } from "react";
import { Wordmark } from "../components/Wordmark";
import {
	IconArrow,
	IconShield,
	IconBolt,
	IconChart,
	IconUsers,
	IconSparkle,
	IconCheck,
} from "../components/icons";
import { useRouter } from "../lib/routerContext";

export function Landing() {
	return (
		<div className="landing">
			<LandingNav />
			<Hero />
			<FeatureGrid />
			<SplitFeature />
			<FAQ />
			<CTA />
			<Footer />
		</div>
	);
}

function LandingNav() {
	const { navigate } = useRouter();
	return (
		<header className="ln-nav">
			<Wordmark size="md" />
			<nav className="ln-nav-links">
				<a href="#features">Features</a>
				<a href="#security">Security</a>
				<a href="#pricing">Pricing</a>
				<a href="#docs">Docs</a>
			</nav>
			<div className="ln-nav-cta">
				<button className="btn btn-link" onClick={() => navigate("/login")}>
					Log in
				</button>
				<button className="btn btn-primary btn-sm" onClick={() => navigate("/register")}>
					Get started <IconArrow size={15} />
				</button>
			</div>
		</header>
	);
}

function Hero() {
	const { navigate } = useRouter();
	return (
		<section className="hero">
			<div className="hero-copy">
				<span className="eyebrow">
					<span className="eyebrow-dot" /> New — Shared household budgeting
				</span>
				<h1 className="hero-h1">
					Every dollar,
					<br />
					accounted&nbsp;for.
				</h1>
				<p className="hero-sub">
					Obsidian unifies your accounts, transactions, and goals into a single source of truth — built
					for households who actually want to plan.
				</p>
				<div className="hero-cta">
					<button className="btn btn-primary btn-lg" onClick={() => navigate("/register")}>
						Create free account <IconArrow size={16} />
					</button>
					<button className="btn btn-ghost btn-lg" onClick={() => navigate("/login")}>
						I already have one
					</button>
				</div>
				<div className="hero-trust">
					<div className="trust-item">
						<IconShield size={15} /> Bank-level encryption
					</div>
					<div className="trust-item">
						<IconCheck size={15} /> No card required
					</div>
					<div className="trust-item">
						<IconBolt size={15} /> 2-min setup
					</div>
				</div>
			</div>
			<div className="hero-viz">
				<DashboardPreview />
			</div>
		</section>
	);
}

type Range = "1M" | "6M" | "1Y" | "All";

function DashboardPreview() {
	const [range, setRange] = useState<Range>("6M");

	const series: Record<Range, { points: string; label: string }> = {
		"1M": {
			points: "0,55 30,52 60,58 90,46 120,50 150,42 180,48 210,38 240,44 270,30 300,34",
			label: "Apr · $1,820",
		},
		"6M": {
			points: "0,70 30,55 60,62 90,40 120,48 150,30 180,38 210,18 240,28 270,12 300,20",
			label: "Apr · $9,402",
		},
		"1Y": {
			points: "0,82 30,72 60,76 90,60 120,66 150,48 180,55 210,38 240,42 270,22 300,16",
			label: "Apr · $18,640",
		},
		All: {
			points:
				"0,90 25,84 50,72 75,76 100,64 125,68 150,50 175,52 200,38 225,30 250,18 275,14 300,6",
			label: "Apr · $184,210",
		},
	};
	const big: Record<Range, string> = {
		"1M": "$9,210",
		"6M": "$184,210",
		"1Y": "$184,210",
		All: "$184,210",
	};
	const delta: Record<Range, string> = {
		"1M": "▲ $480 this month",
		"6M": "▲ $4,310 this month",
		"1Y": "▲ $22,800 this year",
		All: "▲ $148,300 all time",
	};

	const cur = series[range];
	const fillPoints = `0,90 ${cur.points} 300,90`;
	const tipPoints = cur.points.split(" ");
	const lastPt = tipPoints[tipPoints.length - 1].split(",").map(Number);

	return (
		<div className="dash">
			<div className="dash-glow" />
			<div className="dash-frame">
				<div className="dash-chrome">
					<div className="dash-dots">
						<span />
						<span />
						<span />
					</div>
					<div className="dash-tab">app.obsidian.money / overview</div>
					<div className="dash-tab-spacer" />
				</div>

				<div className="dash-body">
					<aside className="dash-side">
						<div className="dash-side-brand">
							<span className="wordmark-mark" style={{ width: 18, height: 18 }} />
							<span style={{ fontWeight: 600, fontSize: 13 }}>Obsidian</span>
						</div>
						<div className="dash-side-section">
							<div className="dash-side-label">Workspace</div>
							<div className="dash-side-item active">Overview</div>
							<div className="dash-side-item">Transactions</div>
							<div className="dash-side-item">Accounts</div>
							<div className="dash-side-item">Goals</div>
							<div className="dash-side-item">Reports</div>
						</div>
						<div className="dash-side-section">
							<div className="dash-side-label">Group</div>
							<div className="dash-side-item with-avatar">
								<span className="ava ava-1">M</span> Morgan
							</div>
							<div className="dash-side-item with-avatar">
								<span className="ava ava-2">J</span> Jordan
							</div>
						</div>
					</aside>

					<div className="dash-main">
						<div className="dash-main-head">
							<div>
								<div className="dash-eyebrow">Net worth</div>
								<div
									className="dash-bignum mono"
									key={range + "-num"}
									style={{ fontWeight: 500, opacity: 1 }}
								>
									{big[range]}
								</div>
								<div className="dash-delta up">{delta[range]}</div>
							</div>
							<div className="dash-range">
								{(["1M", "6M", "1Y", "All"] as Range[]).map((r) => (
									<button
										key={r}
										className={`dash-range-btn ${range === r ? "active" : ""}`}
										onClick={() => setRange(r)}
									>
										{r}
									</button>
								))}
							</div>
						</div>

						<div className="dash-chart">
							<svg
								viewBox="0 0 300 100"
								preserveAspectRatio="none"
								width="100%"
								height="160"
								key={range}
							>
								<defs>
									<linearGradient id="chFill" x1="0" x2="0" y1="0" y2="1">
										<stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
										<stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
									</linearGradient>
									<linearGradient id="chLine" x1="0" x2="1" y1="0" y2="0">
										<stop offset="0%" stopColor="var(--brand)" />
										<stop offset="100%" stopColor="var(--accent)" />
									</linearGradient>
								</defs>
								<g stroke="var(--line)" strokeWidth="0.5" strokeDasharray="2 2">
									<line x1="0" y1="20" x2="300" y2="20" />
									<line x1="0" y1="50" x2="300" y2="50" />
									<line x1="0" y1="80" x2="300" y2="80" />
								</g>
								<polygon points={fillPoints} fill="url(#chFill)" className="chart-fade" />
								<polyline
									points={cur.points}
									fill="none"
									stroke="url(#chLine)"
									strokeWidth="1.6"
									strokeLinejoin="round"
									strokeLinecap="round"
									className="chart-fade"
								/>
								<circle
									cx={lastPt[0]}
									cy={lastPt[1]}
									r="3.5"
									fill="white"
									stroke="var(--brand)"
									strokeWidth="1.6"
								/>
								<g
									transform={`translate(${Math.max(0, lastPt[0] - 50)}, ${Math.max(2, lastPt[1] - 16)})`}
								>
									<rect width="58" height="14" rx="3" fill="var(--ink)" />
									<text
										x="29"
										y="9.5"
										textAnchor="middle"
										fontSize="6"
										fill="white"
										fontFamily="Geist Mono"
									>
										{cur.label}
									</text>
								</g>
							</svg>
						</div>

						<div className="dash-cards">
							<MiniCard label="Spending" value="$3,284" delta="−12% MoM" />
							<MiniCard label="Income" value="$8,940" delta="+4%" up />
							<MiniCard label="Savings" value="$2,108" delta="On pace" up />
						</div>

						<div className="dash-tx">
							<div className="dash-tx-head">
								<span style={{ fontWeight: 600, fontSize: 12.5 }}>Recent transactions</span>
								<span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Last 7 days</span>
							</div>
							{[
								{ name: "Whole Foods Market", cat: "Groceries", amt: "−$84.20", col: "tx-1" },
								{ name: "Apple", cat: "Subscriptions", amt: "−$9.99", col: "tx-2" },
								{
									name: "Acme Corp · Payroll",
									cat: "Income",
									amt: "+$4,210.00",
									col: "tx-3",
									positive: true,
								},
								{ name: "Shell", cat: "Gas", amt: "−$48.10", col: "tx-4" },
							].map((t, i) => (
								<div key={i} className="dash-tx-row">
									<span className={`tx-tag ${t.col}`}>{t.cat[0]}</span>
									<div className="tx-meta">
										<div className="tx-name">{t.name}</div>
										<div className="tx-cat">{t.cat}</div>
									</div>
									<div className={`tx-amt mono ${t.positive ? "pos" : ""}`}>{t.amt}</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function MiniCard({ label, value, delta, up }: { label: string; value: string; delta: string; up?: boolean }) {
	return (
		<div className="mini-card">
			<div className="mini-label">{label}</div>
			<div className="mini-value mono">{value}</div>
			<div className={`mini-delta ${up ? "up" : ""}`}>{delta}</div>
		</div>
	);
}

function FeatureGrid() {
	const items = [
		{ i: <IconChart size={18} />, t: "Unified accounts", d: "Connect every checking, savings, credit card, and investment in minutes." },
		{ i: <IconUsers size={18} />, t: "Built for groups", d: "Share visibility with a partner, family, or roommate — without sharing logins." },
		{ i: <IconBolt size={18} />, t: "Auto-categorized", d: "Transactions get sorted, tagged, and reconciled before you open the app." },
		{ i: <IconSparkle size={18} />, t: "Goals that adapt", d: "Track savings, debt payoff, or sinking funds with budgets that flex with reality." },
		{ i: <IconShield size={18} />, t: "Privacy-first", d: "Read-only connections, encryption at rest, no selling your data. Ever." },
		{ i: <IconCheck size={18} />, t: "Reconcile in seconds", d: "Match statements, split transactions, and close the month without dread." },
	];

	return (
		<section className="features" id="features">
			<div className="section-head">
				<span className="eyebrow">
					<span className="eyebrow-dot" /> Features
				</span>
				<h2 className="section-h2">A clear view of your money, finally.</h2>
				<p className="section-sub">
					Everything you need to plan, track, and share — without the spreadsheet sprawl.
				</p>
			</div>
			<div className="feature-grid">
				{items.map((f, i) => (
					<div key={i} className="feature-card">
						<div className="feature-icon">{f.i}</div>
						<h3 className="feature-t">{f.t}</h3>
						<p className="feature-d">{f.d}</p>
					</div>
				))}
			</div>
		</section>
	);
}

function SplitFeature() {
	return (
		<section className="split" id="security">
			<div className="split-copy">
				<span className="eyebrow">
					<span className="eyebrow-dot" /> Households
				</span>
				<h2 className="section-h2">Plan together. Without the friction.</h2>
				<p className="section-sub">
					Invite a partner or roommate, choose what to share, and align on goals. Everyone sees what they
					need — nothing they don't.
				</p>
				<ul className="check-list">
					<li>
						<IconCheck size={16} /> Per-account visibility controls
					</li>
					<li>
						<IconCheck size={16} /> Roles for group leader, member, and viewer
					</li>
					<li>
						<IconCheck size={16} /> Shared categories with personal overrides
					</li>
					<li>
						<IconCheck size={16} /> Audit log of every change
					</li>
				</ul>
			</div>
			<div className="split-viz">
				<GroupCard />
			</div>
		</section>
	);
}

function GroupCard() {
	const members = [
		{ n: "Morgan Park", r: "Group leader", c: "ava-1" },
		{ n: "Jordan Park", r: "Member", c: "ava-2" },
		{ n: "Riley Park", r: "Viewer · pending", c: "ava-3" },
	];
	return (
		<div className="group-card">
			<div className="group-card-head">
				<div>
					<div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Group</div>
					<div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.018em" }}>
						The Park Avenue Household
					</div>
				</div>
				<span className="pill">3 members</span>
			</div>
			<div className="group-members">
				{members.map((m, i) => (
					<div key={i} className="group-member">
						<span className={`ava ${m.c}`}>{m.n[0]}</span>
						<div className="member-meta">
							<div className="member-name">{m.n}</div>
							<div className="member-role">{m.r}</div>
						</div>
						{m.r.includes("pending") ? (
							<span className="pill pill-warn">Invite sent</span>
						) : (
							<span className="pill pill-ok">Active</span>
						)}
					</div>
				))}
			</div>
			<div className="group-card-foot">
				<span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Invite by email</span>
				<button className="btn btn-sm btn-ghost">+ Add member</button>
			</div>
		</div>
	);
}

function FAQ() {
	const items = [
		{
			q: "Is my financial data safe with Obsidian?",
			a: "Yes. We use read-only connections to your bank — Obsidian can never move money on your behalf. Data is encrypted in transit and at rest with 256-bit encryption, and we never sell your data to advertisers or third parties.",
		},
		{
			q: "How do shared household groups work?",
			a: "Create a group, invite your partner or family by email, and choose what to share. Each member has a role (group leader, member, or viewer) with different permissions. You control which accounts are visible to the group and which stay private.",
		},
		{
			q: "How much does Obsidian cost?",
			a: "Obsidian is free for individuals — connect your accounts, track spending, and set goals at no cost. Paid plans start at $9/month and unlock household sharing for more than two members, advanced reports, and unlimited goals.",
		},
	];

	const [open, setOpen] = useState(-1);
	return (
		<section className="faq" id="faq">
			<div className="section-head">
				<span className="eyebrow">
					<span className="eyebrow-dot" /> FAQ
				</span>
				<h2 className="section-h2">Questions, answered.</h2>
				<p className="section-sub">Everything you might want to know before you sign up.</p>
			</div>
			<div className="faq-list">
				{items.map((it, i) => {
					const isOpen = open === i;
					return (
						<div key={i} className={`faq-item ${isOpen ? "open" : ""}`}>
							<button
								className="faq-q"
								onClick={() => setOpen(isOpen ? -1 : i)}
								aria-expanded={isOpen}
							>
								<span>{it.q}</span>
								<span className="faq-icon" aria-hidden>
									<svg
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="M6 9l6 6 6-6" />
									</svg>
								</span>
							</button>
							<div className="faq-a-wrap">
								<div className="faq-a">
									<div className="faq-a-inner">{it.a}</div>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function CTA() {
	const { navigate } = useRouter();
	return (
		<section className="cta">
			<div className="cta-card">
				<div className="cta-bg" />
				<div className="cta-grid" style={{ opacity: 0 }} />
				<div className="cta-inner">
					<h2 className="cta-h">Ready to see the whole picture?</h2>
					<p className="cta-sub">
						Free to start. No card. No nonsense. You can be up and running in two minutes.
					</p>
					<div className="cta-actions">
						<button className="btn btn-brand btn-lg" onClick={() => navigate("/register")}>
							Create your account <IconArrow size={16} />
						</button>
						<button
							className="btn btn-ghost btn-lg"
							style={{ color: "white", borderColor: "rgba(255,255,255,0.18)" }}
							onClick={() => navigate("/login")}
						>
							Log in
						</button>
					</div>
				</div>
			</div>
		</section>
	);
}

function Footer() {
	return (
		<footer className="ln-foot ln-foot-min">
			<div className="ln-foot-min-inner">
				<Wordmark size="sm" />
				<nav className="ln-foot-min-nav">
					<a href="#about">About</a>
					<a href="#contact">Contact</a>
				</nav>
				<span className="ln-foot-min-copy">© 2026 Obsidian Money, Inc.</span>
			</div>
		</footer>
	);
}
