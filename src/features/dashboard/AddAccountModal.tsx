import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { api, ApiError } from "../../lib/api";
import { ModalShell } from "./modals";
import {
	ACCOUNT_TYPE_OPTIONS,
	SUBTYPE_OPTIONS,
	type ManualAccountType,
} from "./accountTaxonomy";

type Mode = "choose" | "manual";

// Lets the user add an account after their initial Plaid sync — either by
// linking another bank through Plaid or by entering an account by hand. On
// success it calls onAdded so the dashboard can refetch and show the new account.
export function AddAccountModal({
	onClose,
	onAdded,
}: {
	onClose: () => void;
	onAdded: () => void;
}) {
	const [mode, setMode] = useState<Mode>("choose");

	// Plaid link token, fetched up front so Link is ready the moment the user
	// picks "Connect a bank". Single-use — re-minted after each exchange.
	const [linkToken, setLinkToken] = useState<string | null>(null);
	const [exchanging, setExchanging] = useState(false);
	const [plaidError, setPlaidError] = useState("");

	useEffect(() => {
		let cancelled = false;
		api.createLinkToken()
			.then((res) => {
				if (!cancelled) setLinkToken(res.link_token);
			})
			.catch((e) => {
				if (cancelled) return;
				setPlaidError(
					e instanceof ApiError
						? e.message
						: "Couldn't start Plaid Link. Please try again."
				);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const onSuccess = useCallback<PlaidLinkOnSuccess>(
		async (publicToken) => {
			setPlaidError("");
			setExchanging(true);
			try {
				await api.exchangePublicToken(publicToken);
				onAdded();
				onClose();
			} catch (e) {
				setPlaidError(
					e instanceof ApiError
						? e.message
						: "Couldn't finish connecting that bank. Please try again."
				);
				setExchanging(false);
			}
		},
		[onAdded, onClose]
	);

	const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

	if (mode === "manual") {
		return (
			<ManualAccountForm
				onBack={() => setMode("choose")}
				onClose={onClose}
				onSaved={onAdded}
			/>
		);
	}

	return (
		<ModalShell
			title="Add an account"
			sub="Connect another bank through Plaid, or add an account manually."
			onClose={onClose}
		>
			<div className="db-form">
				<button
					type="button"
					className="db-link-row"
					disabled={!ready || !linkToken || exchanging}
					onClick={() => open()}
				>
					<div>
						<div className="db-link-row-t">
							{exchanging ? "Connecting…" : "Connect a bank"}
						</div>
						<div className="db-link-row-d">
							Securely link an institution and import balances + transactions.
						</div>
					</div>
				</button>

				<button
					type="button"
					className="db-link-row"
					onClick={() => setMode("manual")}
				>
					<div>
						<div className="db-link-row-t">Add manually</div>
						<div className="db-link-row-d">
							Track an account Plaid can't connect to — enter the details yourself.
						</div>
					</div>
				</button>

				{plaidError ? <div className="field-error">{plaidError}</div> : null}
			</div>
		</ModalShell>
	);
}

// An existing manual account being edited. type is one of Plaid's top-level
// types (which double as ManualAccountType); balance_current is the raw stored
// value (no debt-sign flip — the dashboard negates credit/loan for display only).
export type EditingAccount = {
	id: number;
	account_name: string;
	type: ManualAccountType;
	subtype: string | null;
	institution_name: string | null;
	last_four: string | null;
	balance_current: number | null;
};

// Add or edit a manual account. When `editing` is passed the form is pre-filled
// and saves via PATCH; otherwise it creates. `onBack` is only shown in the create
// flow (to return to the Plaid/manual chooser); edit mode shows Cancel instead.
export function ManualAccountForm({
	editing,
	onBack,
	onClose,
	onSaved,
	onDeleted,
	readOnly = false,
}: {
	editing?: EditingAccount;
	onBack?: () => void;
	onClose: () => void;
	onSaved: () => void;
	// Only meaningful in edit mode — when provided, a Delete (remove) button is
	// shown. Called after the account is removed (soft delete; history is kept).
	onDeleted?: () => void;
	// Plaid accounts are read-only: their details are managed by Plaid and can't
	// be edited here. The only available action is removing the account, which
	// also stops it from syncing going forward.
	readOnly?: boolean;
}) {
	const isEdit = editing != null;
	const [name, setName] = useState(editing?.account_name ?? "");
	const [type, setType] = useState<ManualAccountType>(editing?.type ?? "depository");
	const [subtype, setSubtype] = useState<string>(
		editing?.subtype ?? SUBTYPE_OPTIONS[editing?.type ?? "depository"][0].value
	);
	const [institution, setInstitution] = useState(editing?.institution_name ?? "");
	const [lastFour, setLastFour] = useState(editing?.last_four ?? "");
	const [balance, setBalance] = useState(
		editing?.balance_current != null ? String(editing.balance_current) : ""
	);
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	// When true, the form body is replaced by a delete-confirmation warning.
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	// Set when the account has multiple joint co-owners and the server needs the
	// deleter to choose who inherits it (the 400 carries details.candidates).
	const [transferCandidates, setTransferCandidates] = useState<
		Array<{ user_id: number; first_name: string; last_name: string }> | null
	>(null);
	const [newOwnerId, setNewOwnerId] = useState<number | null>(null);

	const isDebt = type === "credit" || type === "loan";

	const handleDelete = async (chosenOwnerId?: number) => {
		if (!editing) return;
		setError("");
		setDeleting(true);
		try {
			await api.deleteAccount(editing.id, chosenOwnerId);
			onDeleted?.();
		} catch (err) {
			// Multiple co-owners → the server returns a candidate list so the user can
			// pick who the account transfers to, then we retry with that choice.
			const candidates =
				err instanceof ApiError &&
				err.details &&
				typeof err.details === "object" &&
				"candidates" in err.details
					? (err.details as {
							candidates: Array<{
								user_id: number;
								first_name: string;
								last_name: string;
							}>;
					  }).candidates
					: null;
			if (candidates) {
				setTransferCandidates(candidates);
				setNewOwnerId(candidates[0]?.user_id ?? null);
			} else {
				setError(
					err instanceof ApiError
						? err.message
						: "Couldn't remove the account. Please try again."
				);
			}
			setDeleting(false);
		}
	};

	const handleType = (next: ManualAccountType) => {
		setType(next);
		// Reset subtype to the first valid option for the new type.
		setSubtype(SUBTYPE_OPTIONS[next][0].value);
	};

	const submit = async (e?: FormEvent) => {
		e?.preventDefault();
		setError("");

		if (!name.trim()) {
			setError("Enter an account name.");
			return;
		}
		if (lastFour && !/^\d{4}$/.test(lastFour)) {
			setError("Last 4 digits must be exactly 4 numbers.");
			return;
		}
		const parsedBalance = balance.trim() === "" ? null : Number(balance);
		if (parsedBalance !== null && Number.isNaN(parsedBalance)) {
			setError("Enter a valid balance amount.");
			return;
		}

		setSaving(true);
		try {
			const payload = {
				account_name: name.trim(),
				type,
				subtype,
				institution_name: institution.trim() || null,
				last_four: lastFour || null,
				balance_current: parsedBalance,
			};
			if (isEdit) {
				await api.updateManualAccount(editing.id, payload);
			} else {
				await api.createManualAccount(payload);
			}
			onSaved();
			onClose();
		} catch (err) {
			setError(
				err instanceof ApiError
					? err.message
					: "Couldn't save the account. Please try again."
			);
			setSaving(false);
		}
	};

	// Delete confirmation — replaces the form body with a warning. The X in the
	// corner still closes the whole modal (ModalShell's onClose).
	if (confirmingDelete && editing) {
		const choosing = transferCandidates != null;
		return (
			<ModalShell
				title={choosing ? "Transfer this account?" : "Remove account?"}
				onClose={onClose}
				footer={
					<>
						<button
							className="btn btn-ghost"
							onClick={() => {
								setConfirmingDelete(false);
								setTransferCandidates(null);
							}}
							disabled={deleting}
						>
							Cancel
						</button>
						<div style={{ flex: 1 }} />
						<button
							className="btn btn-danger-solid"
							onClick={() =>
								void handleDelete(choosing ? newOwnerId ?? undefined : undefined)
							}
							disabled={deleting || (choosing && newOwnerId == null)}
						>
							{deleting
								? choosing
									? "Transferring…"
									: "Removing…"
								: choosing
								? "Transfer & remove"
								: "Remove account"}
						</button>
					</>
				}
			>
				<div className="db-form">
					{choosing ? (
						<>
							<div className="db-warn">
								<strong>{editing.account_name}</strong> has more than one
								co-owner. Choose who it should transfer to — they'll keep it as
								a manual account (it stops auto-syncing), and you'll lose access.
							</div>
							<label className="db-field">
								<span className="db-field-l">New owner</span>
								<select
									className="input"
									value={newOwnerId ?? ""}
									onChange={(e) => setNewOwnerId(Number(e.target.value))}
								>
									{transferCandidates!.map((c) => (
										<option key={c.user_id} value={c.user_id}>
											{c.first_name} {c.last_name}
										</option>
									))}
								</select>
							</label>
						</>
					) : (
						<div className="db-warn">
							Removing <strong>{editing.account_name}</strong> takes it off your
							dashboard{readOnly ? " and stops syncing it from your bank going forward" : ""}.
							If someone else co-owns it, the account transfers to them instead.
							Your existing <strong>transaction history is kept</strong> — past
							activity still appears in your feed and totals.
						</div>
					)}
					{error ? <div className="field-error">{error}</div> : null}
				</div>
			</ModalShell>
		);
	}

	// Read-only view for Plaid accounts. Details are managed by Plaid and can't
	// be edited — the only action is removing the account (which also stops it
	// from syncing). The X in the corner still closes the modal.
	if (readOnly && editing) {
		const detail = (label: string, value: string | null) => (
			<label className="db-field">
				<span className="db-field-l">{label}</span>
				<input className="input" value={value ?? "—"} disabled readOnly />
			</label>
		);
		return (
			<ModalShell
				title="Account details"
				sub="Synced from your bank through Plaid. These details are managed by Plaid and can't be edited here."
				onClose={onClose}
				footer={
					<>
						<button
							className="btn btn-ghost btn-danger"
							onClick={() => setConfirmingDelete(true)}
						>
							Delete
						</button>
						<div style={{ flex: 1 }} />
						<button className="btn btn-brand" onClick={onClose}>
							Close
						</button>
					</>
				}
			>
				<div className="db-form">
					{detail("Account name", editing.account_name)}
					{detail("Type", editing.type)}
					{detail("Subtype", editing.subtype)}
					{detail("Institution", editing.institution_name)}
					{detail(
						"Last 4 digits",
						editing.last_four ? `•••• ${editing.last_four}` : null
					)}
					{detail(
						"Balance",
						editing.balance_current != null
							? String(editing.balance_current)
							: null
					)}
				</div>
			</ModalShell>
		);
	}

	return (
		<ModalShell
			title={isEdit ? "Edit account" : "Add account manually"}
			sub={
				isEdit
					? "Update the account details."
					: "Enter the account details. Balances won't update automatically."
			}
			onClose={onClose}
			footer={
				<>
					{onBack ? (
						<button className="btn btn-ghost" onClick={onBack} disabled={saving}>
							← Back
						</button>
					) : isEdit && onDeleted ? (
						<button
							className="btn btn-ghost btn-danger"
							onClick={() => setConfirmingDelete(true)}
							disabled={saving}
						>
							Delete
						</button>
					) : (
						<button className="btn btn-ghost" onClick={onClose} disabled={saving}>
							Cancel
						</button>
					)}
					<div style={{ flex: 1 }} />
					<button
						className="btn btn-brand"
						onClick={() => void submit()}
						disabled={saving}
					>
						{saving ? "Saving…" : isEdit ? "Save changes" : "Add account"}
					</button>
				</>
			}
		>
			<form className="db-form" onSubmit={submit}>
				<label className="db-field">
					<span className="db-field-l">Account name</span>
					<input
						className="input"
						placeholder="e.g. Emergency Fund"
						value={name}
						onChange={(ev) => setName(ev.target.value)}
						autoFocus
					/>
				</label>

				<label className="db-field">
					<span className="db-field-l">Type</span>
					<select
						className="input"
						value={type}
						onChange={(ev) => handleType(ev.target.value as ManualAccountType)}
					>
						{ACCOUNT_TYPE_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
				</label>

				<label className="db-field">
					<span className="db-field-l">Subtype</span>
					<select
						className="input"
						value={subtype}
						onChange={(ev) => setSubtype(ev.target.value)}
					>
						{SUBTYPE_OPTIONS[type].map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
				</label>

				<label className="db-field">
					<span className="db-field-l">Institution (optional)</span>
					<input
						className="input"
						placeholder="e.g. Ally Bank"
						value={institution}
						onChange={(ev) => setInstitution(ev.target.value)}
					/>
				</label>

				<label className="db-field">
					<span className="db-field-l">Last 4 digits (optional)</span>
					<input
						className="input"
						placeholder="1234"
						inputMode="numeric"
						maxLength={4}
						value={lastFour}
						onChange={(ev) => setLastFour(ev.target.value.replace(/\D/g, ""))}
					/>
				</label>

				<label className="db-field">
					<span className="db-field-l">
						{isDebt ? "Balance owed (optional)" : "Current balance (optional)"}
					</span>
					<input
						className="input"
						placeholder="0.00"
						inputMode="decimal"
						value={balance}
						onChange={(ev) => setBalance(ev.target.value)}
					/>
				</label>

				{error ? <div className="field-error">{error}</div> : null}
			</form>
		</ModalShell>
	);
}
