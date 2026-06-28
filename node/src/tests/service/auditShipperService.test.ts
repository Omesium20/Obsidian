import { describe, it, expect } from "vitest";
import { buildBatchEntries } from "../../services/audit/auditShipperService.js";
import { AuditLogRow } from "../../repository/auditShipmentRepository.js";

// Minimal AuditLogRow factory — buildBatchEntries is pure, so these don't touch
// the database.
function auditRow(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
	return {
		id: 1,
		user_id: 42,
		group_id: 7,
		table_name: "accounts",
		record_id: 100,
		operation: "UPDATE",
		old_data: { balance: 10 },
		new_data: { balance: 20 },
		action_source: "user",
		changed_at: "2026-06-27T12:00:00.000Z",
		exported_at: null,
		...overrides,
	} as AuditLogRow;
}

describe("auditShipperService.buildBatchEntries", () => {
	it("uses the audit row id as both the batch Id and the dedup id", () => {
		const [entry] = buildBatchEntries([auditRow({ id: 555 })]);

		expect(entry.Id).toBe("555");
		expect(entry.MessageDeduplicationId).toBe("555");
	});

	it("groups by <table>:<record_id> so a record's events stay ordered", () => {
		const entries = buildBatchEntries([
			auditRow({ id: 1, table_name: "accounts", record_id: 100 }),
			auditRow({ id: 2, table_name: "accounts", record_id: 100 }),
			auditRow({ id: 3, table_name: "transactions", record_id: 100 }),
		]);

		// Same table+record share a group; a different table is a different group
		// even when record_id collides.
		expect(entries.map((e) => e.MessageGroupId)).toEqual([
			"accounts:100",
			"accounts:100",
			"transactions:100",
		]);
	});

	it("serializes the audit payload as JSON without the exported_at column", () => {
		const [entry] = buildBatchEntries([auditRow({ id: 9 })]);
		const body = JSON.parse(entry.MessageBody!);

		expect(body).toEqual({
			id: 9,
			user_id: 42,
			group_id: 7,
			table_name: "accounts",
			record_id: 100,
			operation: "UPDATE",
			old_data: { balance: 10 },
			new_data: { balance: 20 },
			action_source: "user",
			changed_at: "2026-06-27T12:00:00.000Z",
		});
		expect(body).not.toHaveProperty("exported_at");
	});

	it("produces one entry per row, preserving order", () => {
		const entries = buildBatchEntries([
			auditRow({ id: 1 }),
			auditRow({ id: 2 }),
			auditRow({ id: 3 }),
		]);

		expect(entries.map((e) => e.Id)).toEqual(["1", "2", "3"]);
	});
});
