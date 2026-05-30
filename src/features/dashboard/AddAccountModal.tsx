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
				onAdded={onAdded}
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

function ManualAccountForm({
	onBack,
	onClose,
	onAdded,
}: {
	onBack: () => void;
	onClose: () => void;
	onAdded: () => void;
}) {
	const [name, setName] = useState("");
	const [type, setType] = useState<ManualAccountType>("depository");
	const [subtype, setSubtype] = useState<string>(SUBTYPE_OPTIONS.depository[0].value);
	const [institution, setInstitution] = useState("");
	const [lastFour, setLastFour] = useState("");
	const [balance, setBalance] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);

	const isDebt = type === "credit" || type === "loan";

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
			await api.createManualAccount({
				account_name: name.trim(),
				type,
				subtype,
				institution_name: institution.trim() || null,
				last_four: lastFour || null,
				balance_current: parsedBalance,
			});
			onAdded();
			onClose();
		} catch (err) {
			setError(
				err instanceof ApiError
					? err.message
					: "Couldn't create the account. Please try again."
			);
			setSaving(false);
		}
	};

	return (
		<ModalShell
			title="Add account manually"
			sub="Enter the account details. Balances won't update automatically."
			onClose={onClose}
			footer={
				<>
					<button className="btn btn-ghost" onClick={onBack} disabled={saving}>
						← Back
					</button>
					<div style={{ flex: 1 }} />
					<button
						className="btn btn-brand"
						onClick={() => void submit()}
						disabled={saving}
					>
						{saving ? "Saving…" : "Add account"}
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
