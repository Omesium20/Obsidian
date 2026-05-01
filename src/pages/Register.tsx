import { useState, type ReactNode } from "react";
import { AuthBrand, AuthPaneTop } from "../components/AuthBrand";
import { Field } from "../components/Field";
import {
	PasswordChecklist,
	PasswordInput,
	passwordValid,
} from "../components/PasswordInput";
import {
	IconArrow,
	IconArrowL,
	IconBolt,
	IconCheck,
	IconMail,
	IconShield,
	IconSparkle,
	IconUser,
} from "../components/icons";
import { useQueryParam, useRouter } from "../lib/router";
import { api, ApiError } from "../lib/api";

type FormData = {
	email: string;
	password: string;
	username: string;
	first_name: string;
	last_name: string;
};

export function Register() {
	const { navigate } = useRouter();
	const returnTo = useQueryParam("returnTo");
	const [step, setStep] = useState<1 | 2>(1);
	const [data, setData] = useState<FormData>({
		email: "",
		password: "",
		username: "",
		first_name: "",
		last_name: "",
	});
	const [err, setErr] = useState("");
	const [loading, setLoading] = useState(false);
	const [direction, setDirection] = useState<"forward" | "back">("forward");

	const update = <K extends keyof FormData>(k: K, v: FormData[K]) =>
		setData((d) => ({ ...d, [k]: v }));

	const goNext = () => {
		setErr("");
		if (!data.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
			setErr("Enter a valid email address.");
			return;
		}
		if (!passwordValid(data.password)) {
			setErr("Password must meet all the requirements below.");
			return;
		}
		setDirection("forward");
		setStep(2);
	};

	const goBack = () => {
		setDirection("back");
		setStep(1);
		setErr("");
	};

	const submit = async () => {
		setErr("");
		if (!data.username || data.username.length > 30) {
			setErr("Pick a username (1–30 chars).");
			return;
		}
		if (!data.first_name || !data.last_name) {
			setErr("Add your first and last name.");
			return;
		}
		setLoading(true);
		try {
			await api.register({
				email: data.email,
				password_hash: data.password,
				username: data.username,
				first_name: data.first_name,
				last_name: data.last_name,
			});
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
				<RegisterBrandSide />
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
							Already have an account?{" "}
							<a
								onClick={() => navigate("/login")}
								style={{ cursor: "pointer" }}
							>
								Log in
							</a>
						</>
					}
				/>

				<div className="auth-form" style={{ position: "relative" }}>
					<RegisterStepper step={step} />

					{step === 1 ? (
						<div
							key="s1"
							className={
								direction === "back"
									? "slide-from-left"
									: "fade-in"
							}
						>
							<h1 className="auth-headline">
								Create your account.
							</h1>
							<p className="auth-sub">
								Step 1 of 2 — your sign-in details.
							</p>

							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 18,
									marginTop: 22,
								}}
							>
								<Field label="Email">
									<div className="input-with-icon">
										<span className="icon-left">
											<IconMail size={17} />
										</span>
										<input
											className="input"
											type="email"
											placeholder="you@household.com"
											value={data.email}
											onChange={(e) =>
												update("email", e.target.value)
											}
											autoComplete="email"
										/>
									</div>
								</Field>

								<Field label="Password">
									<PasswordInput
										value={data.password}
										onChange={(v) => update("password", v)}
										placeholder="At least 16 characters"
									/>
									<PasswordChecklist pw={data.password} />
								</Field>

								{err ? (
									<div className="field-error">{err}</div>
								) : null}

								<button
									type="button"
									className="btn btn-primary btn-block btn-lg"
									onClick={goNext}
								>
									Continue <IconArrow size={16} />
								</button>

								<div
									style={{
										fontSize: 12,
										color: "var(--ink-4)",
										textAlign: "center",
									}}
								>
									By continuing, you agree to our{" "}
									<a
										style={{
											textDecoration: "underline",
											color: "var(--ink-3)",
										}}
									>
										Terms
									</a>{" "}
									and{" "}
									<a
										style={{
											textDecoration: "underline",
											color: "var(--ink-3)",
										}}
									>
										Privacy Policy
									</a>
									.
								</div>
							</div>
						</div>
					) : (
						<div key="s2" className="slide-from-right">
							<h1 className="auth-headline">
								Tell us about you.
							</h1>
							<p className="auth-sub">
								Step 2 of 2 — your profile in Obsidian.
							</p>

							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 18,
									marginTop: 22,
								}}
							>
								<Field
									label="Username"
									hint="This is how you appear inside your group."
								>
									<div className="input-with-icon">
										<span className="icon-left">
											<IconUser size={17} />
										</span>
										<input
											className="input"
											type="text"
											placeholder="morganpark"
											value={data.username}
											maxLength={30}
											onChange={(e) =>
												update(
													"username",
													e.target.value.replace(
														/\s/g,
														""
													)
												)
											}
										/>
									</div>
								</Field>

								<div
									style={{
										display: "grid",
										gridTemplateColumns: "1fr 1fr",
										gap: 12,
									}}
								>
									<Field label="First name">
										<input
											className="input"
											type="text"
											placeholder="Morgan"
											value={data.first_name}
											maxLength={50}
											onChange={(e) =>
												update(
													"first_name",
													e.target.value
												)
											}
											autoComplete="given-name"
										/>
									</Field>
									<Field label="Last name">
										<input
											className="input"
											type="text"
											placeholder="Park"
											value={data.last_name}
											maxLength={50}
											onChange={(e) =>
												update(
													"last_name",
													e.target.value
												)
											}
											autoComplete="family-name"
										/>
									</Field>
								</div>

								{err ? (
									<div className="field-error">{err}</div>
								) : null}

								<div style={{ display: "flex", gap: 10 }}>
									<button
										type="button"
										className="btn btn-ghost btn-lg"
										onClick={goBack}
									>
										<IconArrowL size={16} /> Back
									</button>
									<button
										type="button"
										className="btn btn-primary btn-lg"
										style={{ flex: 1 }}
										onClick={submit}
										disabled={loading}
									>
										{loading ? (
											"Creating account…"
										) : (
											<>
												Create account{" "}
												<IconArrow size={16} />
											</>
										)}
									</button>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function RegisterStepper({ step }: { step: 1 | 2 }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginBottom: 4,
			}}
		>
			<StepDot n={1} active={step >= 1} done={step > 1} label="Sign-in" />
			<span
				style={{
					flex: 1,
					height: 1,
					background: step > 1 ? "var(--brand)" : "var(--line)",
					transition: "background 240ms",
				}}
			/>
			<StepDot n={2} active={step >= 2} done={false} label="Profile" />
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
		<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
			<div
				style={{
					width: 24,
					height: 24,
					borderRadius: "50%",
					background: active ? "var(--brand)" : "var(--surface)",
					color: active ? "white" : "var(--ink-3)",
					border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					fontSize: 11.5,
					fontWeight: 600,
					fontFamily: "var(--font-mono)",
					transition: "all 240ms",
				}}
			>
				{done ? <IconCheck size={12} stroke="white" /> : n}
			</div>
			<span
				style={{
					fontSize: 12.5,
					color: active ? "var(--ink)" : "var(--ink-3)",
					fontWeight: active ? 500 : 400,
				}}
			>
				{label}
			</span>
		</div>
	);
}

function RegisterBrandSide() {
	return (
		<>
			<div style={{ flex: 1 }} />
			<div style={{ maxWidth: 420 }}>
				<div
					style={{
						fontSize: 12.5,
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: "rgba(255,255,255,0.55)",
						marginBottom: 16,
					}}
				>
					Why Obsidian
				</div>
				<BrandPoint
					icon={<IconShield size={16} />}
					t="Read-only by design"
					d="We only ever read transactions — we can't move money for you, and that's the point."
				/>
				<BrandPoint
					icon={<IconBolt size={16} />}
					t="Set up in two minutes"
					d="Connect your first account, invite your partner, and you're done."
				/>
				<BrandPoint
					icon={<IconSparkle size={16} />}
					t="Free forever for individuals"
					d="Upgrade only when you add household members or advanced reporting."
				/>
			</div>
			<div
				style={{
					marginTop: "auto",
					fontSize: 12,
					color: "rgba(255,255,255,0.45)",
				}}
			>
				© 2026 Obsidian Money, Inc.
			</div>
		</>
	);
}

function BrandPoint({ icon, t, d }: { icon: ReactNode; t: string; d: string }) {
	return (
		<div
			style={{
				display: "flex",
				gap: 14,
				padding: "14px 0",
				borderTop: "1px solid rgba(255,255,255,0.08)",
			}}
		>
			<div
				style={{
					width: 32,
					height: 32,
					borderRadius: 8,
					background: "rgba(255,255,255,0.08)",
					border: "1px solid rgba(255,255,255,0.10)",
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					color: "white",
					flexShrink: 0,
				}}
			>
				{icon}
			</div>
			<div>
				<div style={{ fontWeight: 500, fontSize: 14, color: "white" }}>
					{t}
				</div>
				<div
					style={{
						fontSize: 13,
						color: "rgba(255,255,255,0.65)",
						lineHeight: 1.5,
						marginTop: 2,
					}}
				>
					{d}
				</div>
			</div>
		</div>
	);
}
