import { describe, it, expect, beforeEach } from "vitest";
import { PoolClient } from "pg";
import { truncateAll, seedAuditLog, pool } from "../helpers/dbHelper.js";
import {
	claimUnexportedBatch,
	markBatchExported,
	countUnexported,
	purgeExportedOlderThan,
} from "../../repository/auditShipmentRepository.js";

// ISO timestamp for `n` days before now — used to age audit rows relative to the
// real wall clock so retention assertions don't depend on hardcoded dates.
const daysAgo = (n: number) =>
	new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// Total rows currently in audit_log.
async function rowCount(): Promise<number> {
	const res = await pool.query<{ count: string }>(
		"SELECT COUNT(*) AS count FROM audit_log"
	);
	return Number(res.rows[0].count);
}

// Acquire a pooled client, run fn, always release. claimUnexportedBatch and
// markBatchExported take a client so the real caller can hold row locks across
// the SQS send; these read-path assertions don't need an explicit transaction
// (autocommit returns the same rows), so this thin wrapper is enough.
async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await pool.connect();
	try {
		return await fn(client);
	} finally {
		client.release();
	}
}

describe("auditShipmentRepository", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	// ============================================
	// claimUnexportedBatch
	// ============================================

	describe("claimUnexportedBatch", () => {
		it("returns only rows that are not yet exported", async () => {
			const unshipped = await seedAuditLog({ record_id: 1 });
			await seedAuditLog({
				record_id: 2,
				exported_at: "2026-01-01T00:00:00Z",
			});

			const rows = await withClient((c) => claimUnexportedBatch(c, 10));

			expect(rows.map((r) => r.id)).toEqual([unshipped.id]);
		});

		it("returns rows oldest-first by changed_at", async () => {
			const newer = await seedAuditLog({
				record_id: 1,
				changed_at: "2026-03-01T00:00:00Z",
			});
			const older = await seedAuditLog({
				record_id: 2,
				changed_at: "2026-01-01T00:00:00Z",
			});
			const middle = await seedAuditLog({
				record_id: 3,
				changed_at: "2026-02-01T00:00:00Z",
			});

			const rows = await withClient((c) => claimUnexportedBatch(c, 10));

			expect(rows.map((r) => r.id)).toEqual([older.id, middle.id, newer.id]);
		});

		it("breaks changed_at ties by id ascending", async () => {
			const ts = "2026-01-01T00:00:00Z";
			const first = await seedAuditLog({ record_id: 1, changed_at: ts });
			const second = await seedAuditLog({ record_id: 2, changed_at: ts });

			const rows = await withClient((c) => claimUnexportedBatch(c, 10));

			expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
		});

		it("respects the batch limit, taking the oldest rows", async () => {
			const r1 = await seedAuditLog({
				record_id: 1,
				changed_at: "2026-01-01T00:00:00Z",
			});
			const r2 = await seedAuditLog({
				record_id: 2,
				changed_at: "2026-01-02T00:00:00Z",
			});
			await seedAuditLog({ record_id: 3, changed_at: "2026-01-03T00:00:00Z" });

			const rows = await withClient((c) => claimUnexportedBatch(c, 2));

			expect(rows.map((r) => r.id)).toEqual([r1.id, r2.id]);
		});

		it("returns an empty array when nothing is unexported", async () => {
			await seedAuditLog({
				record_id: 1,
				exported_at: "2026-01-01T00:00:00Z",
			});

			const rows = await withClient((c) => claimUnexportedBatch(c, 10));

			expect(rows).toEqual([]);
		});

		it("skips rows locked by another transaction (FOR UPDATE SKIP LOCKED)", async () => {
			const locked = await seedAuditLog({
				record_id: 1,
				changed_at: "2026-01-01T00:00:00Z",
			});
			const free = await seedAuditLog({
				record_id: 2,
				changed_at: "2026-01-02T00:00:00Z",
			});

			const locker = await pool.connect();
			const claimer = await pool.connect();
			try {
				// Hold a row lock on `locked` in a separate open transaction.
				await locker.query("BEGIN");
				await locker.query(
					"SELECT id FROM audit_log WHERE id = $1 FOR UPDATE",
					[locked.id]
				);

				// A concurrent claim must skip the locked row and grab the free one
				// instead of blocking on it.
				await claimer.query("BEGIN");
				const rows = await claimUnexportedBatch(claimer, 10);
				await claimer.query("COMMIT");

				expect(rows.map((r) => r.id)).toEqual([free.id]);
			} finally {
				await locker.query("ROLLBACK");
				locker.release();
				claimer.release();
			}
		});
	});

	// ============================================
	// markBatchExported
	// ============================================

	describe("markBatchExported", () => {
		it("stamps exported_at on the given rows", async () => {
			const row = await seedAuditLog({ record_id: 1 });

			await withClient((c) => markBatchExported(c, [row.id]));

			const raw = await pool.query(
				"SELECT exported_at FROM audit_log WHERE id = $1",
				[row.id]
			);
			expect(raw.rows[0].exported_at).not.toBeNull();
		});

		it("removes marked rows from the next claim", async () => {
			const a = await seedAuditLog({
				record_id: 1,
				changed_at: "2026-01-01T00:00:00Z",
			});
			const b = await seedAuditLog({
				record_id: 2,
				changed_at: "2026-01-02T00:00:00Z",
			});

			await withClient((c) => markBatchExported(c, [a.id]));
			const rows = await withClient((c) => claimUnexportedBatch(c, 10));

			expect(rows.map((r) => r.id)).toEqual([b.id]);
		});

		it("only marks the given ids, leaving others untouched", async () => {
			const a = await seedAuditLog({ record_id: 1 });
			const b = await seedAuditLog({ record_id: 2 });

			await withClient((c) => markBatchExported(c, [a.id]));

			const raw = await pool.query(
				"SELECT id, exported_at FROM audit_log ORDER BY id"
			);
			const exportedById = new Map(
				raw.rows.map((r) => [Number(r.id), r.exported_at])
			);
			expect(exportedById.get(Number(a.id))).not.toBeNull();
			expect(exportedById.get(Number(b.id))).toBeNull();
		});

		it("is a no-op on an empty id list", async () => {
			const row = await seedAuditLog({ record_id: 1 });

			await withClient((c) => markBatchExported(c, []));

			const raw = await pool.query(
				"SELECT exported_at FROM audit_log WHERE id = $1",
				[row.id]
			);
			expect(raw.rows[0].exported_at).toBeNull();
		});
	});

	// ============================================
	// countUnexported
	// ============================================

	describe("countUnexported", () => {
		it("counts only unexported rows", async () => {
			await seedAuditLog({ record_id: 1 });
			await seedAuditLog({ record_id: 2 });
			await seedAuditLog({
				record_id: 3,
				exported_at: "2026-01-01T00:00:00Z",
			});

			expect(await countUnexported()).toBe(2);
		});

		it("returns 0 when there are no rows", async () => {
			expect(await countUnexported()).toBe(0);
		});

		it("decreases after rows are marked exported", async () => {
			const a = await seedAuditLog({ record_id: 1 });
			await seedAuditLog({ record_id: 2 });
			expect(await countUnexported()).toBe(2);

			await withClient((c) => markBatchExported(c, [a.id]));

			expect(await countUnexported()).toBe(1);
		});
	});

	// ============================================
	// purgeExportedOlderThan
	// ============================================

	describe("purgeExportedOlderThan", () => {
		it("deletes exported rows older than the retention window", async () => {
			const old = await seedAuditLog({
				record_id: 1,
				changed_at: daysAgo(10),
				exported_at: daysAgo(10),
			});

			const deleted = await purgeExportedOlderThan(7);

			expect(deleted).toBe(1);
			const raw = await pool.query("SELECT id FROM audit_log WHERE id = $1", [
				old.id,
			]);
			expect(raw.rows).toHaveLength(0);
		});

		it("keeps exported rows newer than the retention window", async () => {
			await seedAuditLog({
				record_id: 1,
				changed_at: daysAgo(2),
				exported_at: daysAgo(2),
			});

			const deleted = await purgeExportedOlderThan(7);

			expect(deleted).toBe(0);
			expect(await rowCount()).toBe(1);
		});

		it("never deletes unexported rows, even when old (safety)", async () => {
			const old = await seedAuditLog({
				record_id: 1,
				changed_at: daysAgo(30),
				exported_at: null,
			});

			const deleted = await purgeExportedOlderThan(7);

			expect(deleted).toBe(0);
			const raw = await pool.query("SELECT id FROM audit_log WHERE id = $1", [
				old.id,
			]);
			expect(raw.rows).toHaveLength(1);
		});

		it("deletes only the rows that are both old and exported", async () => {
			// old + exported -> deleted
			await seedAuditLog({
				record_id: 1,
				changed_at: daysAgo(10),
				exported_at: daysAgo(10),
			});
			// old but unexported -> kept (unshipped event)
			const unexported = await seedAuditLog({
				record_id: 2,
				changed_at: daysAgo(10),
				exported_at: null,
			});
			// recent + exported -> kept (inside hot window)
			const recent = await seedAuditLog({
				record_id: 3,
				changed_at: daysAgo(2),
				exported_at: daysAgo(2),
			});

			const deleted = await purgeExportedOlderThan(7);

			expect(deleted).toBe(1);
			const remaining = await pool.query(
				"SELECT id FROM audit_log ORDER BY id"
			);
			expect(remaining.rows.map((r) => Number(r.id))).toEqual([
				Number(unexported.id),
				Number(recent.id),
			]);
		});

		it("drains a backlog larger than one batch", async () => {
			for (let i = 1; i <= 5; i++) {
				await seedAuditLog({
					record_id: i,
					changed_at: daysAgo(10),
					exported_at: daysAgo(10),
				});
			}

			// batchSize of 2 forces multiple delete passes.
			const deleted = await purgeExportedOlderThan(7, 2);

			expect(deleted).toBe(5);
			expect(await rowCount()).toBe(0);
		});
	});
});
