import { pool } from "../../config/database.js";
import { plaidClient } from "../../config/plaid.js";
import { Tables } from "../../config/types.js";
import { getDecryptedAccessToken } from "../../repository/plaidItemRepository.js";

type PlaidItem = Tables<"plaid_items">;

// One recurring outflow stream (subscription, bill, recurring payment) as shown
// on the dashboard's Subscriptions panel. Amounts keep Plaid's outflow-stream
// convention — positive = money leaving the account — since the panel displays
// them as costs, not as signed ledger entries.
export interface RecurringOutflow {
	stream_id: string;
	account_id: number | null;
	account_name: string | null;
	description: string;
	merchant_name: string | null;
	category: string | null;
	frequency: string;
	average_amount: number | null;
	last_amount: number | null;
	first_date: string;
	last_date: string;
	predicted_next_date: string | null;
	status: string;
	// All-time net spend on this stream (positive magnitude) and how many of its
	// transactions we have stored — summed from our own transactions table via
	// the stream's plaid transaction ids, so it covers the full synced history.
	total_spent: number;
	charge_count: number;
}

export interface RecurringOutflowsResult {
	streams: RecurringOutflow[];
	errors: Array<{ itemId: number; message: string }>;
}

// Fetch recurring transaction streams for the given Plaid items via
// /transactions/recurring/get. Inflow streams (recurring deposits like payroll)
// are intentionally ignored — the panel is about recurring spending — as are
// streams Plaid has marked inactive (the merchant stopped charging). Per-item
// failures are collected, not thrown, so one dead bank link can't blank the
// whole panel for a multi-bank household.
export const getRecurringOutflows = async (
	items: PlaidItem[]
): Promise<RecurringOutflowsResult> => {
	const errors: RecurringOutflowsResult["errors"] = [];
	const collected: Array<{
		plaidAccountId: string;
		transactionIds: string[];
		stream: RecurringOutflow;
	}> = [];

	for (const item of items) {
		try {
			const accessToken = getDecryptedAccessToken(item);
			const res = await plaidClient.transactionsRecurringGet({
				access_token: accessToken,
			});

			for (const s of res.data.outflow_streams) {
				if (!s.is_active) continue;
				collected.push({
					plaidAccountId: s.account_id,
					transactionIds: s.transaction_ids,
					stream: {
						stream_id: s.stream_id,
						account_id: null,
						account_name: null,
						description: s.description,
						merchant_name: s.merchant_name ?? null,
						// Same category convention as the transaction sync.
						category:
							s.personal_finance_category?.primary ??
							s.category?.[0] ??
							null,
						frequency: s.frequency,
						average_amount: s.average_amount?.amount ?? null,
						last_amount: s.last_amount?.amount ?? null,
						first_date: s.first_date,
						last_date: s.last_date,
						predicted_next_date: s.predicted_next_date ?? null,
						status: s.status,
						total_spent: 0,
						charge_count: 0,
					},
				});
			}
		} catch (e) {
			errors.push({
				itemId: item.id,
				message: e instanceof Error ? e.message : String(e),
			});
		}
	}

	// Resolve Plaid account ids to local account ids/names in one query. Streams
	// on accounts the user has since removed (is_active = false) are dropped.
	if (collected.length > 0) {
		const plaidIds = [...new Set(collected.map((c) => c.plaidAccountId))];
		const res = await pool.query(
			`SELECT id, account_name, plaid_account_id
			   FROM accounts
			  WHERE plaid_account_id = ANY($1) AND is_active = true`,
			[plaidIds]
		);
		const byPlaidId = new Map<string, { id: number; account_name: string }>(
			res.rows.map((r) => [r.plaid_account_id, { id: r.id, account_name: r.account_name }])
		);
		for (const c of collected) {
			const acct = byPlaidId.get(c.plaidAccountId);
			if (!acct) continue;
			c.stream.account_id = acct.id;
			c.stream.account_name = acct.account_name;
		}
	}

	const kept = collected.filter((c) => c.stream.account_id !== null);

	// All-time spend per stream, summed from our stored transactions in one
	// query. Stored amounts are sign-flipped (negative = outflow), so negating
	// the sum yields a positive cost; in-stream refunds net against it.
	if (kept.length > 0) {
		const allIds = [...new Set(kept.flatMap((c) => c.transactionIds))];
		const res = await pool.query(
			`SELECT plaid_id, amount FROM transactions WHERE plaid_id = ANY($1)`,
			[allIds]
		);
		const amountByPlaidId = new Map<string, number>(
			res.rows.map((r) => [r.plaid_id, Number(r.amount)])
		);
		for (const c of kept) {
			for (const txId of c.transactionIds) {
				const amount = amountByPlaidId.get(txId);
				if (amount === undefined) continue;
				c.stream.total_spent += -amount;
				c.stream.charge_count++;
			}
			c.stream.total_spent = Math.round(c.stream.total_spent * 100) / 100;
		}
	}

	const streams = kept
		.map((c) => c.stream)
		// Soonest upcoming charge first; streams with no prediction sink to the
		// bottom, ordered by cost so the biggest unknowns still surface.
		.sort((a, b) => {
			if (a.predicted_next_date && b.predicted_next_date) {
				return a.predicted_next_date.localeCompare(b.predicted_next_date);
			}
			if (a.predicted_next_date) return -1;
			if (b.predicted_next_date) return 1;
			return (b.average_amount ?? 0) - (a.average_amount ?? 0);
		});

	return { streams, errors };
};
