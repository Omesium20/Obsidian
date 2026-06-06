import { describe, it, expect, beforeEach } from "vitest";
import {
	truncateAll,
	seedUser,
	seedAccount,
	seedAccountMember,
	seedBalanceSnapshot,
	seedAccountGroupVisibility,
	seedGroup,
	pool,
} from "../helpers/dbHelper.js";
import { upsertAccountSnapshot } from "../../repository/balanceSnapshotRepository.js";
import {
	getUserNetWorthSeries,
	getGroupNetWorthSeries,
} from "../../repository/dashboardRepository.js";

// YYYY-MM-DD for a Date (snapshot_date is a DATE column). Mid-month days are
// used throughout so UTC conversion never shifts the month.
function iso(d: Date): string {
	return d.toISOString().slice(0, 10);
}

// Mirrors the SQL TO_CHAR(month_start, 'Mon YYYY') label, e.g. "May 2026".
function monthLabel(d: Date): string {
	return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

describe("balanceSnapshotRepository", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	// ============================================
	// upsertAccountSnapshot
	// ============================================

	describe("upsertAccountSnapshot", () => {
		it("records a snapshot for an account", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);

			await upsertAccountSnapshot(account.id, 1500);

			const rows = await pool.query(
				"SELECT balance, snapshot_date FROM account_balance_snapshots WHERE account_id = $1",
				[account.id]
			);
			expect(rows.rows).toHaveLength(1);
			expect(Number(rows.rows[0].balance)).toBe(1500);
		});

		it("overwrites the same day's balance instead of inserting a duplicate", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);

			await upsertAccountSnapshot(account.id, 1000);
			await upsertAccountSnapshot(account.id, 1250);

			const rows = await pool.query(
				"SELECT balance FROM account_balance_snapshots WHERE account_id = $1",
				[account.id]
			);
			expect(rows.rows).toHaveLength(1);
			expect(Number(rows.rows[0].balance)).toBe(1250);
		});

		it("is a no-op for a null balance (no row, no throw)", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);

			await upsertAccountSnapshot(account.id, null);

			const rows = await pool.query(
				"SELECT * FROM account_balance_snapshots WHERE account_id = $1",
				[account.id]
			);
			expect(rows.rows).toHaveLength(0);
		});
	});

	// ============================================
	// getUserNetWorthSeries
	// ============================================

	describe("getUserNetWorthSeries", () => {
		it("sums assets minus liabilities and carries balances forward", async () => {
			const user = await seedUser();
			const checking = await seedAccount(user.id, {
				account_name: "Checking",
				type: "depository",
				subtype: "checking",
			});
			const card = await seedAccount(user.id, {
				account_name: "Card",
				type: "credit",
				subtype: "credit card",
				last_four: "9999",
			});
			await seedAccountMember(checking.id, user.id, "owner");
			await seedAccountMember(card.id, user.id, "owner");

			const now = new Date();
			const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
			const cur = new Date(now.getFullYear(), now.getMonth(), 10);

			// Last month both accounts update; this month only the card updates, so
			// the checking balance must carry forward into the current month.
			await seedBalanceSnapshot(checking.id, 1000, iso(prev));
			await seedBalanceSnapshot(card.id, 200, iso(prev));
			await seedBalanceSnapshot(card.id, 250, iso(cur));

			const series = await getUserNetWorthSeries(user.id);

			expect(series).toHaveLength(2);
			// prev: 1000 (asset) − 200 (liability) = 800
			expect(series[0]).toEqual({ month: monthLabel(prev), net_worth: 800 });
			// cur: 1000 carried forward − 250 = 750
			expect(series[1]).toEqual({ month: monthLabel(cur), net_worth: 750 });
		});

		it("returns an empty series when the user has no snapshots", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			const series = await getUserNetWorthSeries(user.id);
			expect(series).toEqual([]);
		});
	});

	// ============================================
	// getGroupNetWorthSeries
	// ============================================

	describe("getGroupNetWorthSeries", () => {
		it("counts only accounts shared with the group", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);

			const shared = await seedAccount(user.id, {
				account_name: "Shared",
				balance_current: 5000,
			});
			const unshared = await seedAccount(user.id, {
				account_name: "Unshared",
				last_four: "0001",
			});
			await seedAccountMember(shared.id, user.id, "owner");
			await seedAccountMember(unshared.id, user.id, "owner");
			// Only the shared account is visible to the group.
			await seedAccountGroupVisibility(shared.id, group.id);

			const now = new Date();
			const day = iso(new Date(now.getFullYear(), now.getMonth(), 5));
			await seedBalanceSnapshot(shared.id, 5000, day);
			await seedBalanceSnapshot(unshared.id, 9999, day);

			const series = await getGroupNetWorthSeries(group.id);

			expect(series.length).toBeGreaterThanOrEqual(1);
			// The unshared 9999 is excluded — only the shared 5000 counts.
			expect(series[series.length - 1].net_worth).toBe(5000);
		});
	});
});
