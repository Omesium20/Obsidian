import cron from "node-cron";
import { purgeExportedOlderThan } from "../../repository/auditShipmentRepository.js";

// ============================================
// Audit log retention sweep
// ============================================
// audit_log doubles as the SQS export outbox. Once a row is exported its durable
// home is S3 (via SQS -> Lambda), so Postgres only needs to keep a short hot
// window of recent events. This daily cron drops exported rows older than the
// retention window to keep the table — and its indexes — small on a high-write
// system. Unexported rows are NEVER deleted (see purgeExportedOlderThan), so a
// broken shipper or SQS outage shows up as a growing backlog rather than as lost
// audit events.
//
// Lives on the scheduler worker alongside startScheduledSync — a single
// dedicated process, so the cron fires once per tick (no horizontal herd).

// How long an exported audit row stays queryable in Postgres before the sweep
// drops it.
const RETENTION_DAYS = 7;

export function startAuditRetention(): void {
	// Daily at 03:00. Dropping week-old, already-exported rows isn't time
	// sensitive; one low-traffic sweep a day keeps the table small without
	// contending with the 30-minute Plaid sync ticks.
	cron.schedule("0 3 * * *", async () => {
		console.log("[auditRetention] Cron tick");
		try {
			const deleted = await purgeExportedOlderThan(RETENTION_DAYS);
			console.log(
				`[auditRetention] Purged ${deleted} exported audit row(s) older than ${RETENTION_DAYS}d`
			);
		} catch (e) {
			// Best-effort — a failed sweep just leaves rows for the next run.
			console.error("[auditRetention] Purge failed", e);
		}
	});

	console.log(
		`[auditRetention] Registered: daily 03:00, retention ${RETENTION_DAYS}d`
	);
}
