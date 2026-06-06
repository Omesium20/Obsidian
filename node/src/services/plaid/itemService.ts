import { CountryCode, AccountBase } from "plaid";
import { pool } from "../../config/database.js";
import { plaidClient } from "../../config/plaid.js";
import { encryptToken } from "../../utils/plaidCrypto.js";
import { insertPlaidItem, insertPlaidAccount, findByUserId } from "../../repository/plaidItemRepository.js";
import { sanitizePlaidAccountType } from "./subtypeMap.js";
import { syncTransactions } from "./transactionsSyncService.js";
import { upsertAccountSnapshot } from "../../repository/balanceSnapshotRepository.js";
import { ExternalServiceError, DatabaseError, ConflictError } from "../../errors/index.js";

export interface LinkedAccount {
	id: number;
	plaid_account_id: string;
	account_name: string;
	type: string;
	subtype: string | null;
	institution_name: string | null;
	last_four: string | null;
	balance_current: number | null;
	balance_available: number | null;
}

export interface ExchangeResult {
	plaidItemRowId: number;
	institutionName: string | null;
	accounts: LinkedAccount[];
	transactionCount: number;
}

export const exchangePublicToken = async (
	userId: number,
	groupId: number,
	publicToken: string
): Promise<ExchangeResult> => {
	// 1. Exchange public_token for a long-lived access_token
	let accessToken: string;
	let itemId: string;
	try {
		const ex = await plaidClient.itemPublicTokenExchange({
			public_token: publicToken,
		});
		accessToken = ex.data.access_token;
		itemId = ex.data.item_id;
	} catch (e) {
		throw new ExternalServiceError("Plaid", "Failed to exchange public token", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}

	// 2. Fetch accounts + the item's institution_id
	let plaidAccounts: AccountBase[];
	let institutionId: string | null;
	try {
		const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
		plaidAccounts = accountsRes.data.accounts;
		institutionId = accountsRes.data.item.institution_id ?? null;
	} catch (e) {
		throw new ExternalServiceError("Plaid", "Failed to fetch accounts", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}

	// 3. Resolve institution name (best-effort; sandbox may not always return one)
	let institutionName: string | null = null;
	if (institutionId) {
		try {
			const instRes = await plaidClient.institutionsGetById({
				institution_id: institutionId,
				country_codes: [CountryCode.Us],
			});
			institutionName = instRes.data.institution.name;
		} catch {
			// non-fatal: we'll just store null
		}
	}

	// 3b. Reject a duplicate link of the same institution for this user. Without
	// this, re-linking a bank creates a second plaid_item plus a fresh set of
	// accounts (Plaid issues new account_ids each link, so the UNIQUE constraint
	// on plaid_account_id never catches it), leaving the dashboard showing every
	// account twice. Guard requires an institution_id; sandbox occasionally omits
	// it, in which case we can't dedupe and fall through.
	if (institutionId) {
		const existing = await findByUserId(userId);
		if (existing.some((item) => item.institution_id === institutionId)) {
			throw new ConflictError("This institution is already linked to your account.", {
				institutionId,
				institutionName,
			});
		}
	}

	// 4. Encrypt the access_token
	const encrypted = encryptToken(accessToken);

	// 5. Persist plaid_item + accounts + memberships + visibility in one transaction
	const client = await pool.connect();
	let plaidItemRowId: number;
	const linkedAccounts: LinkedAccount[] = [];
	try {
		await client.query("BEGIN");

		const plaidItem = await insertPlaidItem(
			{
				userId,
				plaidItemId: itemId,
				institutionId,
				institutionName,
				encryptedAccessToken: encrypted,
			},
			client
		);
		plaidItemRowId = plaidItem.id;

		for (const acct of plaidAccounts) {
			const sanitized = sanitizePlaidAccountType(acct.type, acct.subtype);
			if (!sanitized) {
				console.warn("[plaid] skipping unmapped account", {
					plaid_account_id: acct.account_id,
					type: acct.type,
					subtype: acct.subtype,
				});
				continue;
			}

			const { type, subtype } = sanitized;

			const accountRowId = await insertPlaidAccount({
				userId,
				groupId,
				accountName: acct.name,
				type,
				subtype,
				institutionName,
				lastFour: acct.mask ?? null,
				plaidAccountId: acct.account_id,
				plaidItemId: itemId,
				balanceCurrent: acct.balances?.current ?? null,
				balanceAvailable: acct.balances?.available ?? null,
				currencyCode: acct.balances?.iso_currency_code ?? "USD",
			}, client);

			// Seed the net-worth series with the link-time balance, in the same
			// transaction as the account insert.
			await upsertAccountSnapshot(accountRowId, acct.balances?.current ?? null, client);

			linkedAccounts.push({
				id: accountRowId,
				plaid_account_id: acct.account_id,
				account_name: acct.name,
				type,
				subtype,
				institution_name: institutionName,
				last_four: acct.mask ?? null,
				balance_current: acct.balances?.current ?? null,
				balance_available: acct.balances?.available ?? null,
			});
		}

		await client.query("COMMIT");
	} catch (e) {
		await client.query("ROLLBACK");
		throw new DatabaseError("Failed to persist Plaid link", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}

	// 6. Initial transactions sync. Failures here don't roll back the link —
	// the cursor will pick up missed transactions on the next sync attempt.
	let transactionCount = 0;
	try {
		const result = await syncTransactions(plaidItemRowId, accessToken, userId);
		transactionCount = result.added;
	} catch (e) {
		console.warn("[plaid] initial transactions sync failed", {
			plaid_item_row: plaidItemRowId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}

	return {
		plaidItemRowId,
		institutionName,
		accounts: linkedAccounts,
		transactionCount,
	};
};
