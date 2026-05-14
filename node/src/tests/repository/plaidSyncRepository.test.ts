import { describe, it, expect, beforeEach } from "vitest";
import { truncateAll, seedUser, seedGroup, pool } from "../helpers/dbHelper.js";
import {
	claimGroupSync,
	releaseGroupSync,
	resetStaleGroupLocks,
	getGroupsDueForSync,
} from "../../repository/groupRepository.js";
import { findByGroupMembers } from "../../repository/plaidItemRepository.js";

async function seedPlaidItemRow(userId: number, overrides: Record<string, unknown> = {}) {
	const defaults = {
		plaid_item_id: `item_${Date.now()}_${Math.random().toString(36).slice(2)}`,
		access_token_ciphertext: "fake_ct",
		access_token_iv: "fake_iv",
		access_token_tag: "fake_tag",
	};
	const d = { ...defaults, ...overrides };
	const res = await pool.query(
		`INSERT INTO plaid_items
		   (user_id, plaid_item_id, access_token_ciphertext, access_token_iv, access_token_tag)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING *`,
		[userId, d.plaid_item_id, d.access_token_ciphertext, d.access_token_iv, d.access_token_tag]
	);
	return res.rows[0];
}

describe("plaidSyncRepository", () => {
	// =========================================================================
	// claimGroupSync / releaseGroupSync
	// =========================================================================

	describe("claimGroupSync", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("returns true when the lock is free", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			expect(await claimGroupSync(group.id)).toBe(true);
		});

		it("returns false when the lock is already held", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			await claimGroupSync(group.id);
			expect(await claimGroupSync(group.id)).toBe(false);
		});

		it("returns true again after the lock is released", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			await claimGroupSync(group.id);
			await releaseGroupSync(group.id);
			expect(await claimGroupSync(group.id)).toBe(true);
		});
	});

	describe("releaseGroupSync", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("clears is_syncing and sets last_synced_at", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			await claimGroupSync(group.id);
			await releaseGroupSync(group.id);

			const res = await pool.query(
				`SELECT is_syncing, last_synced_at FROM groups WHERE id = $1`,
				[group.id]
			);
			expect(res.rows[0].is_syncing).toBe(false);
			expect(res.rows[0].last_synced_at).not.toBeNull();
		});
	});

	// =========================================================================
	// resetStaleGroupLocks
	// =========================================================================

	describe("resetStaleGroupLocks", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("does not touch a recently claimed lock", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			await claimGroupSync(group.id);

			await resetStaleGroupLocks();

			const res = await pool.query(
				`SELECT is_syncing FROM groups WHERE id = $1`,
				[group.id]
			);
			expect(res.rows[0].is_syncing).toBe(true);
		});

		it("resets a lock whose sync_started_at is older than 10 minutes", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);

			// Manually force a stale lock
			await pool.query(
				`UPDATE groups
				    SET is_syncing = TRUE,
				        sync_started_at = NOW() - INTERVAL '15 minutes'
				  WHERE id = $1`,
				[group.id]
			);

			await resetStaleGroupLocks();

			const res = await pool.query(
				`SELECT is_syncing, sync_started_at FROM groups WHERE id = $1`,
				[group.id]
			);
			expect(res.rows[0].is_syncing).toBe(false);
			expect(res.rows[0].sync_started_at).toBeNull();
		});
	});

	// =========================================================================
	// getGroupsDueForSync
	// =========================================================================

	describe("getGroupsDueForSync", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("includes a group that has never been synced", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);

			const due = await getGroupsDueForSync();
			expect(due.map((g) => g.id)).toContain(group.id);
		});

		it("includes a group last synced more than 7 hours ago", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);

			await pool.query(
				`UPDATE groups SET last_synced_at = NOW() - INTERVAL '8 hours' WHERE id = $1`,
				[group.id]
			);

			const due = await getGroupsDueForSync();
			expect(due.map((g) => g.id)).toContain(group.id);
		});

		it("excludes a group synced recently", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);

			await pool.query(
				`UPDATE groups SET last_synced_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
				[group.id]
			);

			const due = await getGroupsDueForSync();
			expect(due.map((g) => g.id)).not.toContain(group.id);
		});

		it("excludes a group that is currently locked", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			await claimGroupSync(group.id);

			const due = await getGroupsDueForSync();
			expect(due.map((g) => g.id)).not.toContain(group.id);
		});
	});

	// =========================================================================
	// findByGroupMembers
	// =========================================================================

	describe("findByGroupMembers", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("returns empty array when no members have linked banks", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);

			const items = await findByGroupMembers(group.id);
			expect(items).toEqual([]);
		});

		it("returns plaid_items for active group members", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			await seedPlaidItemRow(user.id);

			const items = await findByGroupMembers(group.id);
			expect(items).toHaveLength(1);
			expect(items[0].user_id).toBe(user.id);
		});

		it("does not return items for departed members", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			await seedPlaidItemRow(user.id);

			// Depart the member
			await pool.query(
				`UPDATE group_memberships SET departed_at = NOW() WHERE user_id = $1 AND group_id = $2`,
				[user.id, group.id]
			);

			const items = await findByGroupMembers(group.id);
			expect(items).toEqual([]);
		});

		it("returns items for all active members across multiple users", async () => {
			const user1 = await seedUser({ email: "user1@example.com", username: "user1" });
			const user2 = await seedUser({ email: "user2@example.com", username: "user2" });
			const group = await seedGroup(user1.id);

			// Manually add user2 to the group
			await pool.query(
				`INSERT INTO group_memberships (group_id, user_id, role) VALUES ($1, $2, 'member')`,
				[group.id, user2.id]
			);

			await seedPlaidItemRow(user1.id);
			await seedPlaidItemRow(user2.id);

			const items = await findByGroupMembers(group.id);
			expect(items).toHaveLength(2);
		});
	});
});
