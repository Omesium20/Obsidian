import type { PoolClient } from "pg";
import { pool } from "../config/database.js";
import { DatabaseError } from "../errors/index.js";

// Records one balance snapshot per account per day. The unique constraint on
// (account_id, snapshot_date) makes this idempotent within a day: repeated
// captures (e.g. the 30-min sync cron) overwrite that day's row in place rather
// than piling up rows. Pass an existing pg client to run inside a caller's
// transaction (e.g. the Plaid link insert); omit it to use the shared pool.
export const upsertAccountSnapshot = async (
	accountId: number,
	balance: number | null,
	client?: PoolClient
): Promise<void> => {
	// Nothing to record for an unknown balance — skip rather than store a 0 that
	// would distort the net-worth line.
	if (balance === null || balance === undefined) return;

	const executor = client ?? pool;
	try {
		await executor.query(
			`INSERT INTO account_balance_snapshots (account_id, balance)
			 VALUES ($1, $2)
			 ON CONFLICT (account_id, snapshot_date)
			 DO UPDATE SET balance = EXCLUDED.balance, captured_at = NOW()`,
			[accountId, balance]
		);
	} catch (e) {
		throw new DatabaseError("Failed to record account balance snapshot", {
			accountId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
