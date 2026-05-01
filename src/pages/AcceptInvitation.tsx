import { useState } from "react";
import { Wordmark } from "../components/Wordmark";
import {
	IconArrow,
	IconCheck,
	IconMail,
	IconSparkle,
	IconUser,
	IconUsers,
} from "../components/icons";
import { useQueryParam, useRouter } from "../lib/router";
import { api, ApiError } from "../lib/api";
import type { ReactNode } from "react";

type State = "idle" | "accepted" | "declined" | "needs-auth";

export function AcceptInvitation() {
	const { navigate } = useRouter();
	const token = useQueryParam("token") || "";
	const [state, setState] = useState<State>("idle");
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState("");

	const inv = {
		group: "your invited group",
		role: "Member",
		expiresIn: "7 days",
	};

	const handle = async (action: "accept" | "decline") => {
		setErr("");
		if (!token) {
			setErr("This invitation link is missing a token.");
			return;
		}
		setLoading(true);
		try {
			if (action === "accept") {
				await api.acceptInvitation(token);
				setState("accepted");
			} else {
				await api.declineInvitation(token);
				setState("declined");
			}
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) {
				setState("needs-auth");
			} else {
				setErr(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
			}
		} finally {
			setLoading(false);
		}
	};

	const goLogin = () => {
		const returnTo = encodeURIComponent(`/invitations?token=${token}`);
		navigate(`/login?returnTo=${returnTo}`);
	};

	const goRegister = () => {
		const returnTo = encodeURIComponent(`/invitations?token=${token}`);
		navigate(`/register?returnTo=${returnTo}`);
	};

	return (
		<div className="invite-page">
			<header className="invite-header">
				<a onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
					<Wordmark size="md" />
				</a>
				<a
					onClick={() => navigate("/login")}
					style={{ fontSize: 13.5, color: "var(--ink-2)", cursor: "pointer" }}
				>
					Already a member?{" "}
					<span style={{ color: "var(--ink)", fontWeight: 500 }}>Log in</span>
				</a>
			</header>

			<main className="invite-main">
				{state === "idle" && (
					<div className="invite-card fade-in">
						<div className="invite-stack">
							<div className="invite-avatars">
								<span className="ava ava-1" style={{ width: 56, height: 56, fontSize: 22 }}>
									M
								</span>
								<span className="invite-plus">+</span>
								<span
									className="ava ava-2"
									style={{
										width: 56,
										height: 56,
										fontSize: 22,
										background: "linear-gradient(135deg, var(--brand), var(--accent))",
									}}
								>
									<span
										className="wordmark-mark"
										style={{ width: 28, height: 28, boxShadow: "none" }}
									/>
								</span>
							</div>

							<div style={{ textAlign: "center" }}>
								<div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 8 }}>
									You've been invited
								</div>
								<h1
									style={{
										fontSize: 30,
										letterSpacing: "-0.028em",
										lineHeight: 1.15,
										fontWeight: 600,
										margin: "0 0 12px",
									}}
								>
									<span style={{ color: "var(--ink-2)" }}>You're invited to join</span>
									<br />
									{inv.group}
								</h1>
								<p
									style={{
										fontSize: 14.5,
										color: "var(--ink-3)",
										maxWidth: 420,
										margin: "0 auto",
										lineHeight: 1.5,
									}}
								>
									Accept to join the group and start sharing finances. You'll be added as a{" "}
									<strong style={{ color: "var(--ink-2)" }}>{inv.role}</strong>.
								</p>
							</div>
						</div>

						<div className="invite-detail">
							<DetailRow
								icon={<IconUser size={15} />}
								label="Invitation token"
								value={
									<span className="mono" style={{ fontSize: 12 }}>
										{token ? `${token.slice(0, 12)}…` : "—"}
									</span>
								}
							/>
							<DetailRow icon={<IconUsers size={15} />} label="Group" value={inv.group} />
							<DetailRow icon={<IconSparkle size={15} />} label="Your role" value={inv.role} />
							<DetailRow icon={<IconMail size={15} />} label="Expires" value={`In ${inv.expiresIn}`} />
						</div>

						<div className="invite-perms">
							<div className="invite-perms-title">As a Member, you'll be able to</div>
							<ul>
								<li>
									<IconCheck size={14} /> View shared accounts and transactions
								</li>
								<li>
									<IconCheck size={14} /> Add and categorize transactions
								</li>
								<li>
									<IconCheck size={14} /> Contribute to shared goals
								</li>
							</ul>
							<div
								className="invite-perms-title"
								style={{ marginTop: 14, color: "var(--ink-3)" }}
							>
								You won't be able to
							</div>
							<ul className="muted">
								<li>Remove other members</li>
								<li>Delete the group</li>
							</ul>
						</div>

						{err ? <div className="field-error">{err}</div> : null}

						<div className="invite-actions">
							<button
								className="btn btn-ghost btn-lg"
								style={{ flex: 1 }}
								onClick={() => handle("decline")}
								disabled={loading}
							>
								Decline
							</button>
							<button
								className="btn btn-primary btn-lg"
								style={{ flex: 2 }}
								onClick={() => handle("accept")}
								disabled={loading}
							>
								{loading ? "Joining…" : <>Accept invitation <IconArrow size={16} /></>}
							</button>
						</div>

						<div
							style={{
								fontSize: 12,
								color: "var(--ink-4)",
								textAlign: "center",
								marginTop: 6,
							}}
						>
							By accepting, you agree to share visibility of your transactions with the group leader.
						</div>
					</div>
				)}

				{state === "needs-auth" && (
					<div className="invite-card fade-in" style={{ textAlign: "center" }}>
						<div
							style={{
								width: 64,
								height: 64,
								borderRadius: 16,
								background: "var(--brand-soft)",
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								color: "var(--brand-deep)",
								margin: "0 auto 8px",
							}}
						>
							<IconUser size={28} />
						</div>
						<h1
							style={{
								fontSize: 26,
								letterSpacing: "-0.028em",
								fontWeight: 600,
								margin: "0 0 10px",
							}}
						>
							Sign in to accept.
						</h1>
						<p
							style={{
								fontSize: 14.5,
								color: "var(--ink-3)",
								maxWidth: 420,
								margin: "0 auto 24px",
								lineHeight: 1.5,
							}}
						>
							You need an Obsidian account to join this group. Log in if you have one — or create
							one with the email this invitation was sent to.
						</p>
						<div style={{ display: "flex", gap: 10, width: "100%" }}>
							<button className="btn btn-ghost btn-lg" style={{ flex: 1 }} onClick={goRegister}>
								Create account
							</button>
							<button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={goLogin}>
								Log in <IconArrow size={16} />
							</button>
						</div>
					</div>
				)}

				{state === "accepted" && (
					<div className="invite-card fade-in" style={{ textAlign: "center" }}>
						<div
							style={{
								width: 72,
								height: 72,
								borderRadius: 18,
								background: "oklch(0.95 0.06 150)",
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								color: "oklch(0.45 0.16 150)",
								margin: "0 auto 8px",
							}}
						>
							<IconCheck size={36} />
						</div>
						<h1
							style={{
								fontSize: 28,
								letterSpacing: "-0.028em",
								fontWeight: 600,
								margin: "0 0 10px",
							}}
						>
							You're in.
						</h1>
						<p
							style={{
								fontSize: 14.5,
								color: "var(--ink-3)",
								maxWidth: 420,
								margin: "0 auto 24px",
								lineHeight: 1.5,
							}}
						>
							Welcome to your new group. We'll take you to your overview now.
						</p>
						<button
							className="btn btn-primary btn-lg btn-block"
							onClick={() => navigate("/")}
						>
							Go to overview <IconArrow size={16} />
						</button>
					</div>
				)}

				{state === "declined" && (
					<div className="invite-card fade-in" style={{ textAlign: "center" }}>
						<h1
							style={{
								fontSize: 28,
								letterSpacing: "-0.028em",
								fontWeight: 600,
								margin: "0 0 10px",
							}}
						>
							Invitation declined.
						</h1>
						<p
							style={{
								fontSize: 14.5,
								color: "var(--ink-3)",
								maxWidth: 420,
								margin: "0 auto 24px",
								lineHeight: 1.5,
							}}
						>
							No worries — we've let the inviter know. You can still join later if they send a new
							invitation.
						</p>
						<button className="btn btn-ghost btn-lg btn-block" onClick={() => navigate("/")}>
							Back to home
						</button>
					</div>
				)}
			</main>
		</div>
	);
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
	return (
		<div className="detail-row">
			<span className="detail-icon">{icon}</span>
			<div className="detail-meta">
				<div className="detail-label">{label}</div>
				<div className="detail-value">{value}</div>
			</div>
		</div>
	);
}
