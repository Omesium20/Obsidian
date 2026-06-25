import { pool } from "../../config/database.js";
import { plaidClient } from "../../config/plaid.js";
import { upsertAccountSnapshot } from "../../repository/balanceSnapshotRepository.js";
import { ExternalServiceError } from "../../errors/index.js";
import {
	describePlaidError,
	requiresMinLastUpdated,
	isBalanceOutOfRange,
	extractMostRecentBalanceDatetime,
} from "./plaidError.js";
import type { AccountBase } from "plaid";

// Initial lookback used when an institution forces min_last_updated_datetime
// (Capital One / ins_128026 et al.). It must clear the institution's freshest
// available balance; the sandbox simulates Capital One as perpetually ~24h
// stale, so 24h races it by seconds — give comfortable margin. In production,
// supplying the field triggers a live balance pull whose timestamp is ~now, so
// a wide window costs no freshness. If even this misses, we fall back to the
// exact timestamp Plaid reports (see fetchBalanceAccounts).
const MIN_LAST_UPDATED_LOOKBACK_MS = 48 * 60 * 60 * 1000;

const toPlaidDatetime = (d: Date): string =>
	d.toISOString().replace(/\.\d{3}Z$/, "Z");

const getBalances = async (
	accessToken: string,
	minLastUpdated?: string
): Promise<AccountBase[]> => {
	const res = await plaidClient.accountsBalanceGet({
		access_token: accessToken,
		...(minLastUpdated && {
			options: { min_last_updated_datetime: minLastUpdated },
		}),
	});
	return res.data.accounts;
};

// Fetches balances, transparently handling the institutions that require
// min_last_updated_datetime. Ladder: (1) plain call; (2) on the missing-field
// rejection, retry with a generous lookback; (3) if that lookback is still
// newer than the freshest balance, retry once more against the exact timestamp
// Plaid reports in the out-of-range error. Throws ExternalServiceError on any
// terminal failure.
const fetchBalanceAccounts = async (accessToken: string): Promise<AccountBase[]> => {
	try {
		return await getBalances(accessToken);
	} catch (e) {
		if (!requiresMinLastUpdated(e)) {
			throw new ExternalServiceError(
				"Plaid",
				"Failed to fetch account balances",
				describePlaidError(e)
			);
		}
		const lookback = toPlaidDatetime(new Date(Date.now() - MIN_LAST_UPDATED_LOOKBACK_MS));
		try {
			return await getBalances(accessToken, lookback);
		} catch (retryErr) {
			// Lookback still too fresh: ask for exactly the balance Plaid has,
			// nudged back a minute so the available balance is strictly newer.
			const reported = isBalanceOutOfRange(retryErr)
				? extractMostRecentBalanceDatetime(retryErr)
				: null;
			if (!reported) {
				throw new ExternalServiceError(
					"Plaid",
					"Failed to fetch account balances",
					describePlaidError(retryErr)
				);
			}
			const exact = toPlaidDatetime(new Date(reported.getTime() - 60_000));
			try {
				return await getBalances(accessToken, exact);
			} catch (finalErr) {
				throw new ExternalServiceError(
					"Plaid",
					"Failed to fetch account balances",
					describePlaidError(finalErr)
				);
			}
		}
	}
};

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
	const balanceAccounts = await fetchBalanceAccounts(accessToken);

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
