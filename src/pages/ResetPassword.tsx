import { useState, type FormEvent } from "react";
import { AuthBrand, AuthPaneTop } from "../components/AuthBrand";
import { Field } from "../components/Field";
import { PasswordChecklist, PasswordInput } from "../components/PasswordInput";
import { passwordValid } from "../lib/passwordPolicy";
import { IconArrow, IconArrowL, IconCheck } from "../components/icons";
import { useQueryParam, useRouter } from "../lib/routerContext";
import { api, ApiError } from "../lib/api";

export function ResetPassword() {
	const { navigate } = useRouter();
	const token = useQueryParam("token") || "";
	const [pw, setPw] = useState("");
	const [pw2, setPw2] = useState("");
	const [done, setDone] = useState(false);
	const [err, setErr] = useState("");
	const [loading, setLoading] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setErr("");
		if (!token) {
			setErr("This reset link is missing a token. Request a new one from the forgot-password page.");
			return;
		}
		if (!passwordValid(pw)) {
			setErr("Password must meet all the requirements below.");
			return;
		}
		if (pw !== pw2) {
			setErr("Passwords don't match.");
			return;
		}
		setLoading(true);
		try {
			await api.resetPassword(token, pw);
			setDone(true);
		} catch (e) {
			setErr(
				e instanceof ApiError ? e.message : "Couldn't reset your password. Try requesting a new link."
			);
		} finally {
			setLoading(false);
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
						New password
					</div>
					<div
						style={{
							fontSize: 22,
							lineHeight: 1.35,
							letterSpacing: "-0.018em",
							color: "rgba(255,255,255,0.92)",
						}}
					>
						Choose something long and memorable. Once you reset, you'll be signed out of every other
						device — for your safety.
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
					right={null}
				/>

				{!done ? (
					<form className="auth-form fade-in" onSubmit={submit}>
						<div>
							<h1 className="auth-headline">Set a new password.</h1>
							<p className="auth-sub">
								Make it count — your password protects your entire financial picture.
							</p>
						</div>

						<Field label="New password">
							<PasswordInput value={pw} onChange={setPw} placeholder="At least 16 characters" />
							<PasswordChecklist pw={pw} />
						</Field>

						<Field
							label="Confirm new password"
							error={pw2 && pw !== pw2 ? "Passwords don't match." : null}
						>
							<PasswordInput value={pw2} onChange={setPw2} placeholder="Type it again" />
						</Field>

						{err ? <div className="field-error">{err}</div> : null}

						<button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
							{loading ? "Saving…" : <>Reset password <IconArrow size={16} /></>}
						</button>
					</form>
				) : (
					<div className="auth-form fade-in" style={{ textAlign: "center", alignItems: "center" }}>
						<div
							style={{
								width: 64,
								height: 64,
								borderRadius: 16,
								background: "oklch(0.95 0.06 150)",
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								color: "oklch(0.45 0.16 150)",
								margin: "0 auto",
							}}
						>
							<IconCheck size={32} />
						</div>
						<div>
							<h1 className="auth-headline">Password updated.</h1>
							<p className="auth-sub">
								All other devices have been signed out. You can log in with your new password now.
							</p>
						</div>
						<button
							className="btn btn-primary btn-block btn-lg"
							onClick={() => navigate("/login")}
						>
							Continue to log in <IconArrow size={16} />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
