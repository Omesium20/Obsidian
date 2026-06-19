import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { useRouter, useQueryParam } from "../lib/router";
import { api, ApiError } from "../lib/api";
import { Wordmark } from "../components/Wordmark";

type Step = 1 | 2 | 3;

interface LinkedAccount {
	id: number;
	account_name: string;
	type: string;
	subtype: string | null;
	institution_name: string | null;
	last_four: string | null;
}

interface LinkedInstitution {
	institution_name: string | null;
	accounts: LinkedAccount[];
	transaction_count: number;
}

export function Onboarding() {
	const { navigate } = useRouter();
	const skipInvite = useQueryParam("skipInvite") === "true";
	const [step, setStep] = useState<Step>(1);
	const [institutions, setInstitutions] = useState<LinkedInstitution[]>([]);
	const [sentInvites, setSentInvites] = useState<string[]>([]);

	const goDashboard = () => navigate("/dashboard");

	return (
		<div className="ob-shell">
			<header className="ob-top">
				<Wordmark size="sm" />
				<button className="link-btn ob-skip" onClick={goDashboard}>
					Skip for now
				</button>
			</header>

			<main className="ob-main">
				{!skipInvite && <Stepper step={step} />}

				{step === 1 ? (
					<PlaidStep
						institutions={institutions}
						onLinked={(inst) => setInstitutions((prev) => [...prev, inst])}
						onContinue={() => setStep(2)}
					/>
				) : step === 2 ? (
					<ReviewStep
						accounts={institutions.flatMap((i) => i.accounts)}
						onContinue={skipInvite ? goDashboard : () => setStep(3)}
					/>
				) : (
					<InviteStep
						sentInvites={sentInvites}
						onSent={(email) => setSentInvites((prev) => [...prev, email])}
						onFinish={goDashboard}
					/>
				)}
			</main>
		</div>
	);
}

function Stepper({ step }: { step: Step }) {
	return (
		<div className="ob-stepper">
			<StepDot n={1} active={step >= 1} done={step > 1} label="Connect" />
			<span className={`ob-stepper-line ${step > 1 ? "done" : ""}`} />
			<StepDot n={2} active={step >= 2} done={step > 2} label="Review" />
			<span className={`ob-stepper-line ${step > 2 ? "done" : ""}`} />
			<StepDot n={3} active={step >= 3} done={false} label="Invite" />
		</div>
	);
}

function StepDot({
	n,
	active,
	done,
	label,
}: {
	n: number;
	active: boolean;
	done: boolean;
	label: string;
}) {
	return (
		<div className="ob-stepper-step">
			<div className={`ob-stepper-dot ${active ? "active" : ""} ${done ? "done" : ""}`}>
				{done ? "✓" : n}
			</div>
			<span className={`ob-stepper-l ${active ? "active" : ""}`}>{label}</span>
		</div>
	);
}

function PlaidStep({
	institutions,
	onLinked,
	onContinue,
}: {
	institutions: LinkedInstitution[];
	onLinked: (inst: LinkedInstitution) => void;
	onContinue: () => void;
}) {
	const [linkToken, setLinkToken] = useState<string | null>(null);
	const [tokenError, setTokenError] = useState("");
	const [exchanging, setExchanging] = useState(false);
	const [exchangeError, setExchangeError] = useState("");

	useEffect(() => {
		let cancelled = false;
		api.createLinkToken()
			.then((res) => {
				if (!cancelled) setLinkToken(res.link_token);
			})
			.catch((e) => {
				if (cancelled) return;
				setTokenError(
					e instanceof ApiError
						? e.message
						: "Couldn't start Plaid Link. Please refresh."
				);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const onSuccess = useCallback<PlaidLinkOnSuccess>(
		async (publicToken) => {
			setExchangeError("");
			setExchanging(true);
			try {
				const res = await api.exchangePublicToken(publicToken);
				onLinked({
					institution_name: res.institution_name,
					accounts: res.accounts.map((a) => ({
						id: a.id,
						account_name: a.account_name,
						type: a.type,
						subtype: a.subtype,
						institution_name: a.institution_name,
						last_four: a.last_four,
					})),
					transaction_count: res.transaction_count,
				});
				// Plaid Link tokens are single-use; fetch a fresh one for the next link.
				try {
					const next = await api.createLinkToken();
					setLinkToken(next.link_token);
				} catch {
					setLinkToken(null);
				}
			} catch (e) {
				setExchangeError(
					e instanceof ApiError
						? e.message
						: "Couldn't finish connecting that bank. Please try again."
				);
			} finally {
				setExchanging(false);
			}
		},
		[onLinked]
	);

	const { open, ready } = usePlaidLink({
		token: linkToken,
		onSuccess,
	});

	const linkedCount = institutions.length;

	return (
		<section className="ob-card">
			<h1 className="ob-h1">Connect your accounts</h1>
			<p className="ob-sub">
				We'll pull balances and recent transactions automatically. Read-only —
				we never move money.
			</p>

			{linkedCount > 0 ? (
				<ul className="ob-linked">
					{institutions.map((inst, i) => (
						<li key={i} className="ob-linked-item">
							<div className="ob-linked-head">
								<div className="ob-linked-inst">
									{inst.institution_name ?? "Connected institution"}
								</div>
								<div className="ob-linked-meta">
									{inst.accounts.length} account
									{inst.accounts.length === 1 ? "" : "s"}
									{" · "}
									{inst.transaction_count} transaction
									{inst.transaction_count === 1 ? "" : "s"}
								</div>
							</div>
							<ul className="ob-linked-accounts">
								{inst.accounts.map((a) => (
									<li key={a.id} className="ob-linked-account">
										<span className="ob-linked-an">{a.account_name}</span>
										<span className="ob-linked-at">{a.subtype ?? a.type}</span>
										{a.last_four ? (
											<span className="ob-linked-am">····{a.last_four}</span>
										) : null}
									</li>
								))}
							</ul>
						</li>
					))}
				</ul>
			) : null}

			{tokenError ? <div className="field-error">{tokenError}</div> : null}
			{exchangeError ? <div className="field-error">{exchangeError}</div> : null}

			<div className="ob-actions">
				<button
					className="btn btn-brand"
					disabled={!ready || exchanging || !linkToken}
					onClick={() => open()}
				>
					{exchanging
						? "Connecting…"
						: linkedCount > 0
						? "Connect another bank"
						: "Connect bank"}
				</button>
				{linkedCount > 0 ? (
					<button className="btn btn-ghost" onClick={onContinue}>
						Continue →
					</button>
				) : null}
			</div>
		</section>
	);
}

interface HouseholdMember {
	id: number;
	first_name: string;
	last_name: string;
}

// After linking, let the user label each account before they reach the dashboard:
//  - Private: visible only on their own views, hidden from the household.
//  - Joint: a shared account. When the household already has other members, the
//    user can link a co-owner right here from a dropdown (they'll see the account
//    on their own dashboard, counted once for the household). If they're still
//    solo, they'll invite the co-owner on the next step and link them later.
function ReviewStep({
	accounts,
	onContinue,
}: {
	accounts: LinkedAccount[];
	onContinue: () => void;
}) {
	const [privateIds, setPrivateIds] = useState<Set<number>>(new Set());
	const [jointIds, setJointIds] = useState<Set<number>>(new Set());
	// account id → set of member ids already linked as co-owners.
	const [linked, setLinked] = useState<Map<number, Set<number>>>(new Map());
	const [members, setMembers] = useState<HouseholdMember[]>([]);
	const [busy, setBusy] = useState<Set<number>>(new Set());
	const [error, setError] = useState("");

	// Pull the household roster so joint accounts can be linked to a member on the
	// spot. Excludes the current user (they already own the account).
	useEffect(() => {
		let cancelled = false;
		api
			.getDashboardSummary()
			.then((s) => {
				if (cancelled) return;
				setMembers(
					s.members
						.filter((m) => m.id !== s.user.id)
						.map((m) => ({ id: m.id, first_name: m.first_name, last_name: m.last_name }))
				);
			})
			.catch(() => {
				/* non-fatal: dropdown just won't have anyone to link */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const withBusy = async (id: number, fn: () => Promise<void>) => {
		setError("");
		setBusy((p) => new Set(p).add(id));
		try {
			await fn();
		} catch (e) {
			setError(
				e instanceof ApiError ? e.message : "Couldn't save that change. Try again."
			);
		} finally {
			setBusy((p) => {
				const n = new Set(p);
				n.delete(id);
				return n;
			});
		}
	};

	const togglePrivate = (id: number) => {
		const next = !privateIds.has(id);
		void withBusy(id, async () => {
			await api.setAccountVisibility(id, next ? "private" : "group");
			setPrivateIds((p) => {
				const n = new Set(p);
				if (next) n.add(id);
				else n.delete(id);
				return n;
			});
		});
	};

	const toggleJoint = (id: number) => {
		const next = !jointIds.has(id);
		void withBusy(id, async () => {
			await api.markAccountJoint(id, next);
			setJointIds((p) => {
				const n = new Set(p);
				if (next) n.add(id);
				else n.delete(id);
				return n;
			});
		});
	};

	const linkMember = (accountId: number, memberId: number) => {
		void withBusy(accountId, async () => {
			await api.addCoOwner(accountId, memberId);
			setLinked((prev) => {
				const n = new Map(prev);
				const set = new Set(n.get(accountId) ?? []);
				set.add(memberId);
				n.set(accountId, set);
				return n;
			});
		});
	};

	const memberName = (id: number) => {
		const m = members.find((x) => x.id === id);
		return m ? `${m.first_name} ${m.last_name}` : "Member";
	};

	return (
		<section className="ob-card">
			<h1 className="ob-h1">Review your accounts</h1>
			<p className="ob-sub">
				Mark any account that's <strong>private</strong> (only you see it) or{" "}
				<strong>joint</strong> (shared with someone else). You can change these
				anytime from the account's settings.
			</p>

			{accounts.length === 0 ? (
				<p className="ob-sub">No accounts to review.</p>
			) : (
				<ul className="ob-review">
					{accounts.map((a) => {
						const linkedIds = linked.get(a.id) ?? new Set<number>();
						const linkable = members.filter((m) => !linkedIds.has(m.id));
						return (
							<li key={a.id} className="ob-review-item">
								<div className="ob-review-main">
									<div className="ob-review-info">
										<span className="ob-linked-an">{a.account_name}</span>
										<span className="ob-linked-at">{a.subtype ?? a.type}</span>
										{a.last_four ? (
											<span className="ob-linked-am">····{a.last_four}</span>
										) : null}
									</div>
									<div className="ob-review-toggles">
										<button
											type="button"
											className={`chip ${privateIds.has(a.id) ? "chip-on" : ""}`}
											disabled={busy.has(a.id)}
											onClick={() => togglePrivate(a.id)}
										>
											Private
										</button>
										<button
											type="button"
											className={`chip ${jointIds.has(a.id) ? "chip-on" : ""}`}
											disabled={busy.has(a.id)}
											onClick={() => toggleJoint(a.id)}
										>
											Joint
										</button>
									</div>
								</div>

								{jointIds.has(a.id) ? (
									<div className="ob-review-link">
										{[...linkedIds].map((mid) => (
											<span key={mid} className="tag">
												✓ {memberName(mid)}
											</span>
										))}
										{members.length === 0 ? (
											<span className="ob-review-hint">
												Invite a co-owner on the next step, then link them from the
												account's settings.
											</span>
										) : linkable.length > 0 ? (
											<select
												className="input"
												value=""
												disabled={busy.has(a.id)}
												onChange={(e) => {
													if (e.target.value) linkMember(a.id, Number(e.target.value));
												}}
											>
												<option value="">Link a household member…</option>
												{linkable.map((m) => (
													<option key={m.id} value={m.id}>
														{m.first_name} {m.last_name}
													</option>
												))}
											</select>
										) : (
											<span className="ob-review-hint">All members linked.</span>
										)}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			)}

			{error ? <div className="field-error">{error}</div> : null}

			<div className="ob-actions">
				<button className="btn btn-brand" onClick={onContinue}>
					Continue →
				</button>
			</div>
		</section>
	);
}

function InviteStep({
	sentInvites,
	onSent,
	onFinish,
}: {
	sentInvites: string[];
	onSent: (email: string) => void;
	onFinish: () => void;
}) {
	const [email, setEmail] = useState("");
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);

	const submit = async () => {
		setError("");
		if (!email || !email.includes("@")) {
			setError("Enter a valid email.");
			return;
		}
		setSending(true);
		try {
			await api.sendInvitation(email);
			onSent(email);
			setEmail("");
		} catch (e) {
			setError(
				e instanceof ApiError
					? e.message
					: "Couldn't send invitation. Try again."
			);
		} finally {
			setSending(false);
		}
	};

	return (
		<section className="ob-card">
			<h1 className="ob-h1">Invite household members</h1>
			<p className="ob-sub">
				Members can add their own accounts and see shared data. You can do this
				later from settings.
			</p>

			{sentInvites.length > 0 ? (
				<ul className="ob-invites">
					{sentInvites.map((e) => (
						<li key={e} className="ob-invite-item">
							<span className="ob-invite-mail">{e}</span>
							<span className="ob-invite-state">Invite sent</span>
						</li>
					))}
				</ul>
			) : null}

			<div className="ob-invite-row">
				<input
					className="input"
					type="email"
					placeholder="name@household.com"
					value={email}
					onChange={(ev) => setEmail(ev.target.value)}
					disabled={sending}
				/>
				<button
					className="btn btn-brand"
					onClick={() => void submit()}
					disabled={sending}
				>
					{sending ? "Sending…" : "Send invite"}
				</button>
			</div>

			{error ? <div className="field-error">{error}</div> : null}

			<div className="ob-actions">
				<button className="btn btn-ghost" onClick={onFinish}>
					{sentInvites.length > 0 ? "Finish →" : "Skip for now"}
				</button>
			</div>
		</section>
	);
}
