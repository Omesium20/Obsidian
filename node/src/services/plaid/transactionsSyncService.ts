import { Transaction as PlaidTransaction, RemovedTransaction } from "plaid";
import { pool } from "../../config/database.js";
import { plaidClient } from "../../config/plaid.js";
import { updateCursor } from "../../repository/plaidItemRepository.js";
import { ExternalServiceError, DatabaseError } from "../../errors/index.js";
import { describePlaidError } from "./plaidError.js";

interface SyncResult {
	added: number;
	modified: number;
	removed: number;
}

// Pulls /transactions/sync until has_more is false, then applies all three
// deltas: INSERT for added, UPDATE for modified (handles pending → posted),
// DELETE for removed. Inserts use ON CONFLICT (plaid_id) DO NOTHING so retries
// are idempotent.
export const syncTransactions = async (
	plaidItemRowId: number,
	accessToken: string,
	userId: number,
	startCursor?: string | null
): Promise<SyncResult> => {
	let cursor: string | undefined = startCursor ?? undefined;
	const added: PlaidTransaction[] = [];
	const modified: PlaidTransaction[] = [];
	const removed: RemovedTransaction[] = [];
	let hasMore = true;

	while (hasMore) {
		try {
			const res = await plaidClient.transactionsSync({
				access_token: accessToken,
				cursor,
			});
			added.push(...res.data.added);
			modified.push(...res.data.modified);
			removed.push(...res.data.removed);
			hasMore = res.data.has_more;
			cursor = res.data.next_cursor;
		} catch (e) {
			throw new ExternalServiceError(
				"Plaid",
				"Failed to sync transactions",
				describePlaidError(e)
			);
		}
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		// added: insert the row, then link it to the right account.
		// Sign convention: Plaid uses positive=outflow. We flip so that our
		// transactions.amount is positive=inflow (income, deposits, refunds)
		// and negative=outflow (purchases, withdrawals). Every consumer below
		// the Plaid sync layer sees the "natural" personal-finance sign.
		for (const tx of added) {
			// Resolve the destination account FIRST and require it to still be
			// active. If the account was removed (soft-deleted, is_active = false)
			// or never existed, we skip the transaction entirely — no transactions
			// row is written. This is what makes "delete an account" stop syncing:
			// a deactivated account silently drops all future Plaid transactions,
			// and we never create an orphan transactions row with no
			// account_transactions link.
			const acctRes = await client.query(
				`SELECT id FROM accounts WHERE plaid_account_id = $1 AND is_active = true`,
				[tx.account_id]
			);
			if (acctRes.rows.length === 0) continue;
			const acctRowId: number = acctRes.rows[0].id;

			const category =
				tx.personal_finance_category?.primary ??
				tx.category?.[0] ??
				null;
			const storedAmount = -tx.amount;
			const txRes = await client.query(
				`INSERT INTO transactions
					(user_id, amount, description, transaction_date,
					 category, merchant_name, plaid_id, pending)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				 ON CONFLICT (plaid_id) WHERE plaid_id IS NOT NULL DO NOTHING
				 RETURNING id`,
				[
					userId,
					storedAmount,
					tx.name,
					tx.date,
					category,
					tx.merchant_name ?? null,
					tx.transaction_id,
					tx.pending,
				]
			);
			if (txRes.rows.length === 0) continue;
			const txRowId: number = txRes.rows[0].id;

			// debit = money out of the account, credit = money in.
			const transactionType = storedAmount < 0 ? "debit" : "credit";
			await client.query(
				`INSERT INTO account_transactions (account_id, transaction_id, transaction_type)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (account_id, transaction_id) DO NOTHING`,
				[acctRowId, txRowId, transactionType]
			);
		}

		// modified: most often a pending transaction posting (pending=true → false),
		// but amount/date/category/merchant can also change. Match by plaid_id.
		// Same sign flip as the added path.
		for (const tx of modified) {
			const category =
				tx.personal_finance_category?.primary ??
				tx.category?.[0] ??
				null;
			await client.query(
				`UPDATE transactions
				    SET amount = $1,
				        description = $2,
				        transaction_date = $3,
				        category = $4,
				        merchant_name = $5,
				        pending = $6,
				        updated_at = NOW()
				  WHERE plaid_id = $7`,
				[
					-tx.amount,
					tx.name,
					tx.date,
					category,
					tx.merchant_name ?? null,
					tx.pending,
					tx.transaction_id,
				]
			);
		}

		// removed: bank/Plaid retracted the transaction. account_transactions
		// rows go with it via ON DELETE CASCADE.
		for (const r of removed) {
			if (!r.transaction_id) continue;
			await client.query(`DELETE FROM transactions WHERE plaid_id = $1`, [
				r.transaction_id,
			]);
		}

		await client.query("COMMIT");
	} catch (e) {
		await client.query("ROLLBACK");
		throw new DatabaseError("Failed to persist synced transactions", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}

	if (cursor) {
		await updateCursor(plaidItemRowId, cursor);
	}

	return {
		added: added.length,
		modified: modified.length,
		removed: removed.length,
	};
};
