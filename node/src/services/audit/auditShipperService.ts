import {
	SendMessageBatchCommand,
	SendMessageBatchRequestEntry,
} from "@aws-sdk/client-sqs";
import { pool } from "../../config/database.js";
import { sqsClient, auditQueueUrl, sqsEnabled } from "../../config/sqs.js";
import {
	claimUnexportedBatch,
	markBatchExported,
	AuditLogRow,
} from "../../repository/auditShipmentRepository.js";

// ============================================
// Audit -> SQS shipper
// ============================================
// Drains the audit_log outbox to the SQS FIFO queue. One drain pass per tick
// claims a batch of unexported rows (FOR UPDATE SKIP LOCKED), sends them with
// SendMessageBatch, and stamps exported_at on the rows SQS accepted — all in one
// transaction so the row locks are held across the send. If the send throws, the
// transaction ROLLBACKs and the rows retry next tick; if it PARTIALLY fails, only
// the accepted rows are marked and the rest retry. Downstream, Lambda drains the
// queue to S3 and anything it can't process lands in the DLQ (queue redrive).
//
// at-least-once: a crash between "SQS accepted" and COMMIT re-sends the row next
// tick. The audit row id is the MessageDeduplicationId, so SQS drops the resend
// inside its 5-minute dedup window; idempotent S3 keys cover the rare gap beyond
// it.

// SQS hard-caps a batch at 10 messages / 256 KB. We stay at 10; if old_data/
// new_data snapshots ever push a batch past 256 KB, lower this.
const BATCH_SIZE = 10;

// How often the shipper drains, and how many batches it will pull per tick
// before yielding (bounds a large backlog from monopolizing the worker).
const SHIP_INTERVAL_MS = 30_000;
const MAX_BATCHES_PER_TICK = 20;

// Pull the SQS-facing payload out of an audit row. exported_at is omitted — it's
// always NULL at ship time and is a storage-bookkeeping column, not audit data.
function serializeAuditRow(row: AuditLogRow) {
	return {
		id: row.id,
		user_id: row.user_id,
		group_id: row.group_id,
		table_name: row.table_name,
		record_id: row.record_id,
		operation: row.operation,
		old_data: row.old_data,
		new_data: row.new_data,
		action_source: row.action_source,
		changed_at: row.changed_at,
	};
}

// Map claimed audit rows to SendMessageBatch entries. Pure (no I/O) so it can be
// unit-tested without SQS.
//
// MessageGroupId = "<table>:<record_id>": FIFO orders strictly WITHIN a group, so
// this gives an ordered change-history per audited record while letting different
// records flow in parallel (full throughput). A single global group would force
// the entire audit stream through one serial lane — unnecessary, since we only
// care that each record's own events stay in order.
//
// Auth events (table_name 'auth_events') have no record_id; they all share the
// "auth_events:-" group, which keeps the auth event stream itself in order —
// fine at its volume, and useful when reconstructing an attack timeline.
//
// MessageDeduplicationId = the audit row id: globally unique and stable, so a
// crash-and-resend of an already-accepted row is deduped by SQS.
export function buildBatchEntries(
	rows: AuditLogRow[]
): SendMessageBatchRequestEntry[] {
	return rows.map((row) => ({
		Id: String(row.id),
		MessageBody: JSON.stringify(serializeAuditRow(row)),
		MessageGroupId: `${row.table_name}:${row.record_id ?? "-"}`,
		MessageDeduplicationId: String(row.id),
	}));
}

// Ship one batch. Returns how many rows were accepted by SQS vs. failed. No-op
// (and returns zeros) when SQS is disabled or there's nothing to ship.
export async function shipAuditBatch(
	limit = BATCH_SIZE
): Promise<{ shipped: number; failed: number }> {
	if (!sqsClient || !auditQueueUrl) return { shipped: 0, failed: 0 };

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const rows = await claimUnexportedBatch(client, limit);
		if (rows.length === 0) {
			await client.query("COMMIT");
			return { shipped: 0, failed: 0 };
		}

		const result = await sqsClient.send(
			new SendMessageBatchCommand({
				QueueUrl: auditQueueUrl,
				Entries: buildBatchEntries(rows),
			})
		);

		// Entry Id is the audit row id as a string. Only mark the rows SQS
		// accepted; failed entries keep exported_at NULL and retry next tick.
		const successfulIds = (result.Successful ?? []).map((s) => Number(s.Id));
		await markBatchExported(client, successfulIds);

		await client.query("COMMIT");

		const failed = result.Failed ?? [];
		if (failed.length > 0) {
			console.error(
				`[auditShipper] ${failed.length} message(s) rejected by SQS`,
				failed.map((f) => ({ id: f.Id, code: f.Code, message: f.Message }))
			);
		}
		return { shipped: successfulIds.length, failed: failed.length };
	} catch (e) {
		await client.query("ROLLBACK").catch(() => {});
		throw e;
	} finally {
		client.release();
	}
}

// Reentrancy guard: a slow drain must not overlap the next interval tick.
let draining = false;

async function runDrain(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		let total = 0;
		for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
			const { shipped, failed } = await shipAuditBatch();
			total += shipped;
			// A short batch means the backlog is drained for now — stop pulling.
			if (shipped + failed < BATCH_SIZE) break;
		}
		if (total > 0) console.log(`[auditShipper] shipped ${total} audit row(s)`);
	} catch (e) {
		console.error("[auditShipper] drain failed", e);
	} finally {
		draining = false;
	}
}

export function startAuditShipper(): void {
	if (!sqsEnabled) {
		console.log(
			"[auditShipper] SQS_AUDIT_QUEUE_URL unset — shipper disabled (rows stay unexported)"
		);
		return;
	}
	setInterval(runDrain, SHIP_INTERVAL_MS);
	console.log(
		`[auditShipper] Registered: drain every ${SHIP_INTERVAL_MS / 1000}s -> ${auditQueueUrl}`
	);
}
