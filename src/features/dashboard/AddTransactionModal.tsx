import { useState, type FormEvent } from "react";
import { api, ApiError, type DashboardSummary } from "../../lib/api";
import { ModalShell } from "./modals";
import { TRANSACTION_CATEGORIES } from "./transactionTaxonomy";

type ManualAccount = DashboardSummary["my_accounts"][number];
type Direction = "expense" | "income";

// Returns today's date as YYYY-MM-DD in local time — the default for a new
// transaction and the max selectable date (no future-dating).
function todayISO(): string {
	const d = new Date();
	const off = d.getTimezoneOffset();
	return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

// Lets the user record a transaction by hand — for cash spending or anything
// Plaid can't see. Collects vendor, category, account, date, and amount, then
// posts to the transactions endpoint (which links it to the account so it shows
// up on the dashboard). On success it calls onAdded so the page can refetch.
export function AddTransactionModal({
	accounts,
	onClose,
	onAdded,
}: {
	accounts: ManualAccount[];
	onClose: () => void;
	onAdded: () => void;
}) {
	const [vendor, setVendor] = useState("");
	const [category, setCategory] = useState(TRANSACTION_CATEGORIES[0].value);
	const [accountId, setAccountId] = useState<number | "">(
		accounts[0]?.id ?? ""
	);
	const [date, setDate] = useState(todayISO());
	const [direction, setDirection] = useState<Direction>("expense");
	const [amount, setAmount] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);

	const noAccounts = accounts.length === 0;

	const submit = async (e?: FormEvent) => {
		e?.preventDefault();
		setError("");

		if (!vendor.trim()) {
			setError("Enter the vendor name.");
			return;
		}
		if (accountId === "") {
			setError("Choose an account.");
			return;
		}
		const parsed = Number(amount);
		if (amount.trim() === "" || Number.isNaN(parsed) || parsed <= 0) {
			setError("Enter an amount greater than zero.");
			return;
		}

		// Stored sign: positive = inflow, negative = outflow (matches the
		// transactions table convention). The user always types a positive number;
		// the direction toggle decides the sign.
		const signed = direction === "expense" ? -parsed : parsed;

		setSaving(true);
		try {
			await api.createManualTransaction({
				account_id: accountId,
				transaction_date: date,
				amount: signed,
				merchant_name: vendor.trim(),
				category,
			});
			onAdded();
			onClose();
		} catch (err) {
			setError(
				err instanceof ApiError
					? err.message
					: "Couldn't add the transaction. Please try again."
			);
			setSaving(false);
		}
	};

	return (
		<ModalShell
			title="Add a transaction"
			sub="Record a transaction by hand — for cash spending or anything Plaid can't import."
			onClose={onClose}
			footer={
				<>
					<button className="btn btn-ghost" onClick={onClose} disabled={saving}>
						Cancel
					</button>
					<div style={{ flex: 1 }} />
					<button
						className="btn btn-brand"
						onClick={() => void submit()}
						disabled={saving || noAccounts}
					>
						{saving ? "Saving…" : "Add transaction"}
					</button>
				</>
			}
		>
			{noAccounts ? (
				<div className="tx-empty">
					Add an account first — transactions have to belong to one of your
					accounts.
				</div>
			) : (
				<form className="db-form" onSubmit={submit}>
					<label className="db-field">
						<span className="db-field-l">Vendor</span>
						<input
							className="input"
							placeholder="e.g. Corner Market"
							value={vendor}
							onChange={(ev) => setVendor(ev.target.value)}
							autoFocus
						/>
					</label>

					<div className="db-field">
						<span className="db-field-l">Type</span>
						<div className="seg">
							<button
								type="button"
								className={`seg-btn ${direction === "expense" ? "active" : ""}`}
								onClick={() => setDirection("expense")}
							>
								Expense
							</button>
							<button
								type="button"
								className={`seg-btn ${direction === "income" ? "active" : ""}`}
								onClick={() => setDirection("income")}
							>
								Income
							</button>
						</div>
					</div>

					<label className="db-field">
						<span className="db-field-l">Amount</span>
						<input
							className="input"
							placeholder="0.00"
							inputMode="decimal"
							value={amount}
							onChange={(ev) => setAmount(ev.target.value)}
						/>
					</label>

					<label className="db-field">
						<span className="db-field-l">Category</span>
						<select
							className="input"
							value={category}
							onChange={(ev) => setCategory(ev.target.value)}
						>
							{TRANSACTION_CATEGORIES.map((c) => (
								<option key={c.value} value={c.value}>
									{c.label}
								</option>
							))}
						</select>
					</label>

					<label className="db-field">
						<span className="db-field-l">Account</span>
						<select
							className="input"
							value={accountId}
							onChange={(ev) => setAccountId(Number(ev.target.value))}
						>
							{accounts.map((a) => (
								<option key={a.id} value={a.id}>
									{a.account_name}
									{a.last_four ? ` ••${a.last_four}` : ""}
								</option>
							))}
						</select>
					</label>

					<label className="db-field">
						<span className="db-field-l">Date</span>
						<input
							className="input"
							type="date"
							max={todayISO()}
							value={date}
							onChange={(ev) => setDate(ev.target.value)}
						/>
					</label>

					{error ? <div className="field-error">{error}</div> : null}
				</form>
			)}
		</ModalShell>
	);
}
