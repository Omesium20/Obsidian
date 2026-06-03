import { useState, type FormEvent } from "react";
import { AuthBrand, AuthPaneTop } from "../components/AuthBrand";
import { Field } from "../components/Field";
import { PasswordInput } from "../components/PasswordInput";
import { IconArrow, IconArrowL, IconMail } from "../components/icons";
import { useQueryParam, useRouter } from "../lib/router";
import { api, ApiError } from "../lib/api";

export function Login() {
	const { navigate } = useRouter();
	const returnTo = useQueryParam("returnTo");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState("");

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setErr("");
		if (!email || !password) {
			setErr("Please fill in both fields.");
			return;
		}
		setLoading(true);
		try {
			await api.login(email, password);
			navigate(returnTo || "/dashboard");
		} catch (e) {
			setErr(
				e instanceof ApiError
					? e.message
					: "Something went wrong. Please try again."
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="auth-shell">
			<AuthBrand>
				<BrandFeature
					quote="Obsidian is the first finance app that actually feels like it was made for two people."
					name="Morgan & Jordan"
					role="Group leaders · Joined 2024"
				/>
			</AuthBrand>

			<div className="auth-pane">
				<AuthPaneTop
					left={
						<a
							onClick={() => navigate("/")}
							style={{ cursor: "pointer", color: "var(--ink-2)" }}
						>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
								}}
							>
								<IconArrowL size={14} /> Back to home
							</span>
						</a>
					}
					right={
						<>
							New to Obsidian?{" "}
							<a
								onClick={() => navigate("/register")}
								style={{ cursor: "pointer" }}
							>
								Create account
							</a>
						</>
					}
				/>

				<form className="auth-form fade-in" onSubmit={submit}>
					<div>
						<h1 className="auth-headline">Welcome back.</h1>
						<p className="auth-sub">
							Log in to pick up where you left off.
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
							/>
						</div>
					</Field>

					<Field
						label={
							<span
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "baseline",
								}}
							>
								<span>Password</span>
								<a
									onClick={() => navigate("/forgot-password")}
									style={{
										fontSize: 12.5,
										color: "var(--brand)",
										cursor: "pointer",
										fontWeight: 500,
									}}
								>
									Forgot?
								</a>
							</span>
						}
					>
						<PasswordInput
							value={password}
							onChange={setPassword}
							placeholder="Your password"
							autoComplete="current-password"
						/>
					</Field>

					{err ? <div className="field-error">{err}</div> : null}

					<button
						type="submit"
						className="btn btn-primary btn-block btn-lg"
						disabled={loading}
					>
						{loading ? (
							"Logging in…"
						) : (
							<>
								Log in <IconArrow size={16} />
							</>
						)}
					</button>

					<div
						style={{
							fontSize: 12,
							color: "var(--ink-4)",
							textAlign: "center",
							marginTop: 4,
						}}
					>
						Protected by 256-bit encryption · Your data is never
						sold.
					</div>
				</form>
			</div>
		</div>
	);
}

function BrandFeature({
	quote,
	name,
	role,
}: {
	quote: string;
	name: string;
	role: string;
}) {
	return (
		<>
			<div style={{ flex: 1 }} />
			<div className="brand-quote">"{quote}"</div>
			<div className="brand-quote-attr">
				<span className="avatar">M</span>
				<div>
					<div
						style={{
							color: "rgba(255,255,255,0.92)",
							fontWeight: 500,
						}}
					>
						{name}
					</div>
					<div>{role}</div>
				</div>
			</div>
		</>
	);
}
