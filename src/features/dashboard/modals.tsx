import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import type { GroupView } from "./data";
import { IconArrow } from "../../components/icons";

type ModalShellProps = {
	title: string;
	sub?: string;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	width?: number;
	"aria-label"?: string;
};

export function ModalShell({
	title,
	sub,
	onClose,
	children,
	footer,
	width = 480,
}: ModalShellProps) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className="db-modal-back" onClick={onClose}>
			<div
				className="db-modal"
				style={{ maxWidth: width }}
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<header className="db-modal-head">
					<div>
						<h3 className="db-modal-h">{title}</h3>
						{sub ? <p className="db-modal-sub">{sub}</p> : null}
					</div>
					<button className="db-modal-x" onClick={onClose} aria-label="Close">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M18 6L6 18M6 6l12 12" />
						</svg>
					</button>
				</header>
				<div className="db-modal-body">{children}</div>
				{footer ? <footer className="db-modal-foot">{footer}</footer> : null}
			</div>
		</div>
	);
}

type Role = "leader" | "member" | "viewer";

export function InviteModal({ onClose }: { onClose: () => void }) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("member");
	const [msg, setMsg] = useState("");
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);

	const send = async (e?: FormEvent) => {
		e?.preventDefault();
		if (!email || !email.includes("@")) {
			setMsg("Enter a valid email.");
			return;
		}
		setMsg("");
		setSending(true);
		try {
			await api.sendInvitation(email);
			setSent(true);
		} catch (err) {
			if (err instanceof ApiError) {
				setMsg(err.message);
			} else {
				setMsg("Couldn't send invitation. Please try again.");
			}
		} finally {
			setSending(false);
		}
	};

	if (sent) {
		return (
			<ModalShell
				title="Invitation sent"
				sub={`We emailed ${email} with a link to join your household.`}
				onClose={onClose}
				footer={
					<button className="btn btn-brand" onClick={onClose}>
						Done
					</button>
				}
			>
				<div className="db-success">
					<span className="db-success-icon">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.4"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M20 6L9 17l-5-5" />
						</svg>
					</span>
					<div>
						<div className="db-success-t">Invite delivered</div>
						<div className="db-success-b">
							The link expires in 7 days. They'll join as a{" "}
							{role === "leader"
								? "group leader"
								: role === "member"
								? "full member"
								: "viewer (read-only)"}
							.
						</div>
					</div>
				</div>
			</ModalShell>
		);
	}

	return (
		<ModalShell
			title="Invite a member"
			sub="They'll get an email with a link to join your household."
			onClose={onClose}
			footer={
				<>
					<button className="btn btn-ghost" onClick={onClose} disabled={sending}>
						Cancel
					</button>
					<button
						className="btn btn-brand"
						onClick={() => void send()}
						disabled={sending}
					>
						{sending ? "Sending…" : "Send invite"}
					</button>
				</>
			}
		>
			<form className="db-form" onSubmit={send}>
				<label className="db-field">
					<span className="db-field-l">Email address</span>
					<input
						className="input"
						type="email"
						placeholder="name@household.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoFocus
					/>
				</label>

				<div className="db-field">
					<span className="db-field-l">Role</span>
					<div className="db-roles">
						<RoleOpt
							v="leader"
							cur={role}
							onPick={setRole}
							t="Group leader"
							d="Can manage members and shared accounts."
						/>
						<RoleOpt
							v="member"
							cur={role}
							onPick={setRole}
							t="Member"
							d="Can add accounts and see shared data."
						/>
						<RoleOpt
							v="viewer"
							cur={role}
							onPick={setRole}
							t="Viewer"
							d="Read-only access — can't add or change data."
						/>
					</div>
				</div>

				{msg ? <div className="field-error">{msg}</div> : null}
			</form>
		</ModalShell>
	);
}

function RoleOpt({
	v,
	cur,
	onPick,
	t,
	d,
}: {
	v: Role;
	cur: Role;
	onPick: (v: Role) => void;
	t: string;
	d: string;
}) {
	const active = cur === v;
	return (
		<button
			type="button"
			className={`db-role ${active ? "active" : ""}`}
			onClick={() => onPick(v)}
			aria-pressed={active}
		>
			<span className="db-role-radio">{active ? <span className="db-role-dot" /> : null}</span>
			<span className="db-role-meta">
				<span className="db-role-t">{t}</span>
				<span className="db-role-d">{d}</span>
			</span>
		</button>
	);
}

type SettingsSection = "account" | "household" | "notif" | "security";

export function SettingsModal({
	onClose,
	onLogout,
	onChangePassword,
	onRenameGroup,
	onUpdateProfile,
	user,
	groupName,
	groupViews,
}: {
	onClose: () => void;
	onLogout: () => void;
	onChangePassword: () => void;
	onRenameGroup: (name: string) => Promise<void>;
	onUpdateProfile: (firstName: string, lastName: string) => Promise<void>;
	user: { first_name: string; last_name: string; email: string; username: string };
	groupName: string;
	groupViews: GroupView[];
}) {
	const [section, setSection] = useState<SettingsSection>("account");
	const originalName = `${user.first_name} ${user.last_name}`.trim();
	const [name, setName] = useState(originalName);
	const [email, setEmail] = useState(user.email);
	const [notif, setNotif] = useState(true);
	const [emailNotif, setEN] = useState(true);

	// Only the household's creator may rename it (server enforces this too).
	const isCreator = groupViews.find((g) => g.k === "me")?.role === "creator";
	const [householdName, setHouseholdName] = useState(groupName);
	const [saving, setSaving] = useState(false);
	const [nameErr, setNameErr] = useState("");
	const [groupErr, setGroupErr] = useState("");

	// Persist any pending display-name and household-rename changes, then close.
	// Unchanged values (and, for the household, non-creators) are no-ops. Keeps
	// the modal open on failure so the relevant error is visible.
	const handleSave = async () => {
		setSaving(true);
		setNameErr("");
		setGroupErr("");

		// Display name → first/last (first word, remainder). Any user may do this.
		const trimmedName = name.trim().replace(/\s+/g, " ");
		if (trimmedName && trimmedName !== originalName) {
			const [first, ...rest] = trimmedName.split(" ");
			try {
				await onUpdateProfile(first, rest.join(" "));
			} catch (e) {
				setNameErr(
					e instanceof ApiError
						? e.message
						: "Could not update display name. Please try again."
				);
				setSaving(false);
				return;
			}
		}

		// Household rename — creator only.
		const trimmedHouse = householdName.trim();
		if (isCreator && trimmedHouse && trimmedHouse !== groupName) {
			try {
				await onRenameGroup(trimmedHouse);
			} catch (e) {
				setGroupErr(
					e instanceof ApiError
						? e.message
						: "Could not rename household. Please try again."
				);
				setSaving(false);
				return;
			}
		}

		setSaving(false);
		onClose();
	};

	return (
		<ModalShell
			title="Settings"
			sub="Manage your account, household, and preferences."
			onClose={onClose}
			width={620}
			footer={
				<>
					<button className="btn btn-ghost btn-danger" onClick={onLogout}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.7"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ marginRight: 6, verticalAlign: "-2px" }}
						>
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
							<path d="M16 17l5-5-5-5" />
							<path d="M21 12H9" />
						</svg>
						Log out
					</button>
					<div style={{ flex: 1 }} />
					<button className="btn btn-ghost" onClick={onClose} disabled={saving}>
						Close
					</button>
					<button
						className="btn btn-brand"
						onClick={() => void handleSave()}
						disabled={saving}
					>
						{saving ? "Saving…" : "Save changes"}
					</button>
				</>
			}
		>
			<div className="db-settings">
				<nav className="db-settings-nav">
					{(
						[
							{ k: "account", l: "Account" },
							{ k: "household", l: "Household" },
							{ k: "notif", l: "Notifications" },
							{ k: "security", l: "Security" },
						] as { k: SettingsSection; l: string }[]
					).map((s) => (
						<button
							key={s.k}
							className={`db-settings-nav-btn ${section === s.k ? "active" : ""}`}
							onClick={() => setSection(s.k)}
						>
							{s.l}
						</button>
					))}
				</nav>
				<div className="db-settings-pane">
					{section === "account" ? (
						<>
							<label className="db-field">
								<span className="db-field-l">Display name</span>
								<input
									className="input"
									value={name}
									onChange={(e) => setName(e.target.value)}
									disabled={saving}
									maxLength={101}
								/>
								{nameErr ? (
									<span className="field-error">{nameErr}</span>
								) : null}
							</label>
							<label className="db-field">
								<span className="db-field-l">Email</span>
								<input
									className="input"
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
								/>
							</label>
							<label className="db-field">
								<span className="db-field-l">Username</span>
								<input className="input" defaultValue={user.username} />
							</label>
						</>
					) : null}

					{section === "household" ? (
						<>
							<div className="db-field">
								<span className="db-field-l">Household name</span>
								<input
									className="input"
									value={householdName}
									onChange={(e) => setHouseholdName(e.target.value)}
									disabled={!isCreator || saving}
									maxLength={100}
								/>
								{!isCreator ? (
									<span className="db-field-hint">
										Only the household creator can rename it.
									</span>
								) : null}
								{groupErr ? (
									<span className="field-error">{groupErr}</span>
								) : null}
							</div>
							<div className="db-field">
								<span className="db-field-l">Members</span>
								<ul className="db-member-list">
									{groupViews.filter((g) => g.k !== "group").map((g) => (
										<li key={g.k} className="db-member-li">
											<span className={`ava ${g.col}`}>{g.ava}</span>
											<div className="db-member-meta">
												<div className="db-member-n">{g.name}</div>
												<div className="db-member-r">{g.role}</div>
											</div>
											{g.k !== "me" ? (
												<button className="link-btn db-member-x">Remove</button>
											) : null}
										</li>
									))}
								</ul>
							</div>
						</>
					) : null}

					{section === "notif" ? (
						<>
							<ToggleRow
								label="Push notifications"
								sub="Alerts on your phone for large transactions."
								value={notif}
								onChange={setNotif}
							/>
							<ToggleRow
								label="Email notifications"
								sub="Weekly digest, due bills, and security events."
								value={emailNotif}
								onChange={setEN}
							/>
							<ToggleRow
								label="Group activity"
								sub="When household members add accounts or transactions."
								value
								onChange={() => {}}
							/>
						</>
					) : null}

					{section === "security" ? (
						<>
							<button className="db-link-row" onClick={onChangePassword}>
								<div>
									<div className="db-link-row-t">Change password</div>
									<div className="db-link-row-d">Last changed 84 days ago.</div>
								</div>
								<IconArrow size={14} />
							</button>
							<button className="db-link-row">
								<div>
									<div className="db-link-row-t">Two-factor authentication</div>
									<div className="db-link-row-d">Add an extra layer of security.</div>
								</div>
								<span className="db-pill">Off</span>
							</button>
							<button className="db-link-row">
								<div>
									<div className="db-link-row-t">Active sessions</div>
									<div className="db-link-row-d">2 devices · sign out of all.</div>
								</div>
								<IconArrow size={14} />
							</button>
						</>
					) : null}
				</div>
			</div>
		</ModalShell>
	);
}

function ToggleRow({
	label,
	sub,
	value,
	onChange,
}: {
	label: string;
	sub: string;
	value: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div className="db-toggle-row">
			<div>
				<div className="db-toggle-l">{label}</div>
				<div className="db-toggle-d">{sub}</div>
			</div>
			<button
				className={`db-switch ${value ? "on" : ""}`}
				onClick={() => onChange(!value)}
				aria-pressed={value}
			>
				<span className="db-switch-thumb" />
			</button>
		</div>
	);
}
