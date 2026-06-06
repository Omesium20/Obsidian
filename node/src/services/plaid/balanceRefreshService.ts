import { pool } from "../../config/database.js";
import { plaidClient } from "../../config/plaid.js";
import { upsertAccountSnapshot } from "../../repository/balanceSnapshotRepository.js";
import { ExternalServiceError } from "../../errors/index.js";

// Pulls fresh balances for every account on a Plaid item and writes them back to
// accounts.balance_current / balance_available, then records a daily balance
// snapshot per account. This is what keeps the net-worth chart moving: the
// transaction sync feed never updates balances, so without this refresh every
// snapshot would record the same frozen link-time balance.
//
// Returns the number of accounts whose balance was refreshed. Throws
// ExternalServiceError if the Plaid call fails; the snapshot write per account
// is best-effort (logged, never fatal) so one bad row can't abort the rest.
export const refreshItemBalances = async (accessToken: string): Promise<number> => {
	let balanceAccounts;
	try {
		const res = await plaidClient.accountsBalanceGet({ access_token: accessToken });
		balanceAccounts = res.data.accounts;
	} catch (e) {
		throw new ExternalServiceError("Plaid", "Failed to fetch account balances", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}

	let refreshed = 0;
	for (const acct of balanceAccounts) {
		const current = acct.balances?.current ?? null;
		const available = acct.balances?.available ?? null;

		// Only active accounts; a soft-deleted account stops tracking. RETURNING
		// gives us the row id to snapshot without a second lookup.
		const upd = await pool.query(
			`UPDATE accounts
			    SET balance_current = $1, balance_available = $2, updated_at = NOW()
			  WHERE plaid_account_id = $3 AND is_active = true
			  RETURNING id`,
			[current, available, acct.account_id]
		);
		if (upd.rows.length === 0) continue;
		refreshed++;

		try {
			await upsertAccountSnapshot(upd.rows[0].id as number, current);
		} catch (e) {
			console.warn("[balanceRefresh] snapshot failed", {
				account_id: upd.rows[0].id,
				cause: e instanceof Error ? e.message : String(e),
			});
		}
	}

	return refreshed;
};
