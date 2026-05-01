import { useState, type FormEvent } from "react";
import { AuthBrand, AuthPaneTop } from "../components/AuthBrand";
import { Field } from "../components/Field";
import { IconArrow, IconArrowL, IconMail } from "../components/icons";
import { useRouter } from "../lib/router";
import { api } from "../lib/api";

export function ForgotPassword() {
	const { navigate } = useRouter();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [loading, setLoading] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!email) return;
		setLoading(true);
		try {
			// Backend always returns 200 to avoid leaking which emails exist.
			await api.requestPasswordReset(email);
		} catch {
			// Swallow errors so the confirmation behavior matches the design's privacy promise.
		} finally {
			setLoading(false);
			setSent(true);
		}
	};

	return (
		<div className="auth-shell">
			<AuthBrand>
				<div style={{ flex: 1 }} />
				<div style={{ maxWidth: 420 }}>
					<div
						style={{
							fontSize: 12.5,
							letterSpacing: "0.1em",
							textTransform: "uppercase",
							color: "rgba(255,255,255,0.55)",
							marginBottom: 18,
						}}
					>
						Forgot it happens
					</div>
					<div
						style={{
							fontSize: 22,
							lineHeight: 1.35,
							letterSpacing: "-0.018em",
							color: "rgba(255,255,255,0.92)",
						}}
					>
						We'll send a single-use link to your inbox. The link expires in 30 minutes — and we never
						ask for your password over email.
					</div>
				</div>
				<div style={{ marginTop: "auto", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
					© 2026 Obsidian Money, Inc.
				</div>
			</AuthBrand>

			<div className="auth-pane">
				<AuthPaneTop
					left={
						<a onClick={() => navigate("/login")} style={{ cursor: "pointer", color: "var(--ink-2)" }}>
							<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
								<IconArrowL size={14} /> Back to log in
							</span>
						</a>
					}
					right={
						<>
							Need an account?{" "}
							<a onClick={() => navigate("/register")} style={{ cursor: "pointer" }}>
								Sign up
							</a>
						</>
					}
				/>

				{!sent ? (
					<form className="auth-form fade-in" onSubmit={submit}>
						<div>
							<h1 className="auth-headline">Reset your password.</h1>
							<p className="auth-sub">
								Enter your email and we'll send you a secure link to set a new password.
							</p>
						</div>

						<Field label="Email">
							<div className="input-with-icon">
								<span className="icon-left">
									<IconMail size={17} />
								</span>
								<input
									className="input"
									type="email"
									placeholder="you@household.com"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									autoComplete="email"
									autoFocus
								/>
							</div>
						</Field>

						<button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
							{loading ? "Sending link…" : <>Send reset link <IconArrow size={16} /></>}
						</button>

						<div
							style={{
								fontSize: 12.5,
								color: "var(--ink-3)",
								textAlign: "center",
								lineHeight: 1.5,
							}}
						>
							For your security, we'll show the same confirmation regardless of whether the email
							exists.
						</div>
					</form>
				) : (
					<div className="auth-form fade-in" style={{ textAlign: "center", alignItems: "center" }}>
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
								margin: "0 auto",
							}}
						>
							<IconMail size={28} />
						</div>
						<div>
							<h1 className="auth-headline">Check your inbox.</h1>
							<p className="auth-sub">
								If an account exists for <strong style={{ color: "var(--ink)" }}>{email}</strong>,
								a reset link is on its way. It will expire in 30 minutes.
							</p>
						</div>

						<div
							style={{
								background: "var(--surface-2)",
								border: "1px solid var(--line)",
								borderRadius: 12,
								padding: "14px 16px",
								fontSize: 13,
								color: "var(--ink-2)",
								textAlign: "left",
								width: "100%",
								lineHeight: 1.55,
							}}
						>
							<strong style={{ color: "var(--ink)" }}>Didn't get it?</strong> Check your spam folder,
							or wait 60 seconds and try again. Make sure you used the email tied to your Obsidian
							account.
						</div>

						<div style={{ display: "flex", gap: 10, width: "100%" }}>
							<button
								className="btn btn-ghost btn-lg"
								style={{ flex: 1 }}
								onClick={() => setSent(false)}
							>
								Try a different email
							</button>
							<button
								className="btn btn-primary btn-lg"
								style={{ flex: 1 }}
								onClick={() => navigate("/login")}
							>
								Back to log in
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
