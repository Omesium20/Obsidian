import { PoolClient } from "pg";
import { pool } from "../config/database.js";
import { Tables } from "../config/types.js";
import { DatabaseError } from "../errors/index.js";

// ============================================
// Typing
// ============================================

export type AuditLogRow = Tables<"audit_log">;

// ============================================
// Audit export (SQS) shipment queue
// ============================================
// audit_log doubles as a transactional outbox for the SQS export pipeline: the
// audit trigger writes a row in the same transaction as the business change,
// and this relay drains rows whose `exported_at IS NULL` to SQS, stamping
// `exported_at` once the queue accepts the batch.
//
// `exported_at` means "handed off to SQS", NOT "processed by Lambda into S3".
// Downstream success is recorded in S3 and downstream failure lands in the DLQ;
// neither outcome is reflected back here — the worker only knows SQS accepted
// the message.
//
// claimUnexportedBatch / markBatchExported take a PoolClient so the caller (the
// shipper service) can hold the row locks across the SQS send within ONE
// transaction: claim -> send -> mark -> COMMIT. If the send throws, the caller
// ROLLBACKs and the rows stay unexported for the next tick (at-least-once — SQS
// dedup / idempotent S3 keys absorb a re-send of a row that was accepted just
// before a crash). FOR UPDATE SKIP LOCKED is what makes running >1 worker safe:
// each worker claims a disjoint batch instead of blocking on or double-sending
// another worker's rows. This mirrors the lock-on-Postgres approach used for the
// Plaid sync claim (groupRepository.claimGroupSync).

// Claim the oldest `limit` unexported audit rows, locking them for the current
// transaction. Returns the rows (possibly empty). Served by
// idx_audit_export_queue (the partial index added alongside this repository).
export const claimUnexportedBatch = async (
	client: PoolClient,
	limit: number
): Promise<AuditLogRow[]> => {
	try {
		const res = await client.query<AuditLogRow>(
			`SELECT *
			   FROM audit_log
			  WHERE exported_at IS NULL
			  ORDER BY changed_at ASC, id ASC
			  LIMIT $1
			  FOR UPDATE SKIP LOCKED`,
			[limit]
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to claim unexported audit rows", {
			limit,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Stamp the given rows as exported (delivered to SQS). Must run in the same
// transaction that claimed them, AFTER the SQS send succeeds. No-op on an empty
// list so the caller doesn't have to guard.
export const markBatchExported = async (
	client: PoolClient,
	ids: number[]
): Promise<void> => {
	if (ids.length === 0) return;
	try {
		await client.query(
			`UPDATE audit_log
			    SET exported_at = NOW()
			  WHERE id = ANY($1::bigint[])`,
			[ids]
		);
	} catch (e) {
		throw new DatabaseError("Failed to mark audit rows as exported", {
			ids,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Count rows still awaiting export. Cheap (served by idx_audit_export_queue) —
// intended for backlog metrics / health checks, not the hot path.
export const countUnexported = async (): Promise<number> => {
	try {
		const res = await pool.query<{ count: string }>(
			`SELECT COUNT(*) AS count FROM audit_log WHERE exported_at IS NULL`
		);
		return Number(res.rows[0]?.count ?? 0);
	} catch (e) {
		throw new DatabaseError("Failed to count unexported audit rows", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
