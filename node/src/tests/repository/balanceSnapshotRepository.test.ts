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

// YYYY-MM-DD for a Date (snapshot_date is a DATE column).
function iso(d: Date): string {
	return d.toISOString().slice(0, 10);
}

// YYYY-MM-DD for N days before today — used to seed snapshots at fixed offsets
// from "now" so the series always lands within [first snapshot, today].
function daysAgo(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() - n);
	return iso(d);
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

			// Two days ago both accounts update; today only the card updates, so the
			// checking balance must carry forward through yesterday and today.
			await seedBalanceSnapshot(checking.id, 1000, daysAgo(2));
			await seedBalanceSnapshot(card.id, 200, daysAgo(2));
			await seedBalanceSnapshot(card.id, 250, daysAgo(0));

			const series = await getUserNetWorthSeries(user.id);

			expect(series).toHaveLength(3);
			// 2 days ago: 1000 (asset) − 200 (liability) = 800
			expect(series[0]).toEqual({ date: daysAgo(2), net_worth: 800 });
			// yesterday: both carried forward, still 800
			expect(series[1]).toEqual({ date: daysAgo(1), net_worth: 800 });
			// today: checking carried forward − 250 = 750
			expect(series[2]).toEqual({ date: daysAgo(0), net_worth: 750 });
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

			const day = daysAgo(0);
			await seedBalanceSnapshot(shared.id, 5000, day);
			await seedBalanceSnapshot(unshared.id, 9999, day);

			const series = await getGroupNetWorthSeries(group.id);

			expect(series.length).toBeGreaterThanOrEqual(1);
			// The unshared 9999 is excluded — only the shared 5000 counts.
			expect(series[series.length - 1].net_worth).toBe(5000);
		});
	});
});
