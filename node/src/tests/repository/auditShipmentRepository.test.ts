import { describe, it, expect, beforeEach } from "vitest";
import { PoolClient } from "pg";
import { truncateAll, seedAuditLog, pool } from "../helpers/dbHelper.js";
import {
	claimUnexportedBatch,
	markBatchExported,
	countUnexported,
} from "../../repository/auditShipmentRepository.js";

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
});
