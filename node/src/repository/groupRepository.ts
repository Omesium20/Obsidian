import { PoolClient } from "pg";
import { pool } from "../config/database.js";
import { Tables, TablesInsert } from "../config/types.js";
import { DatabaseError, NotFoundError } from "../errors/index.js";

// ============================================
// Typing
// ============================================

type Group = Tables<"groups">;
type GroupMembership = Tables<"group_memberships">;

// ============================================
// Repository Functions
// ============================================

//Get all groups in the database
export const getAllGroups = async (): Promise<Group[]> => {
	try {
		const res = await pool.query("SELECT * FROM groups");
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch groups", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

//Find group by ID
export const findById = async (groupId: number): Promise<Group | undefined> => {
	try {
		const res = await pool.query("SELECT * FROM groups WHERE id = $1", [
			groupId,
		]);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to fetch group", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Create a new group and register the creator as a member in a single transaction.
// Pass `client` to participate in an existing transaction; otherwise this opens its own.
export const newGroup = async (
	groupData: TablesInsert<"groups">,
	userId: number,
	client?: PoolClient
): Promise<Group> => {
	const useExternal = client !== undefined;
	const c = client ?? (await pool.connect());
	try {
		if (!useExternal) await c.query("BEGIN");

		const groupRes = await c.query(
			`INSERT INTO groups (name, member_count)
			VALUES($1, $2)
			RETURNING *`,
			[groupData.name, groupData.member_count]
		);
		const group: Group = groupRes.rows[0];

		await c.query(
			`INSERT INTO group_memberships (group_id, user_id, role)
			VALUES($1, $2, 'creator')`,
			[group.id, userId]
		);

		if (!useExternal) await c.query("COMMIT");
		return group;
	} catch (e) {
		if (!useExternal) await c.query("ROLLBACK");
		throw new DatabaseError("Failed to create group", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		if (!useExternal) c.release();
	}
};

// Create a fresh personal "<first_name>'s Household" auto-group for the user
// and grant visibility into every account the user is a member of. Used at
// registration and to restore solo state after leave / kick / group-delete.
export const createPersonalGroupForUser = async (
	userId: number,
	client?: PoolClient
): Promise<Group> => {
	const useExternal = client !== undefined;
	const c = client ?? (await pool.connect());
	try {
		if (!useExternal) await c.query("BEGIN");

		const userRes = await c.query(
			`SELECT first_name FROM users WHERE id = $1`,
			[userId]
		);
		if (userRes.rows.length === 0) {
			throw new NotFoundError("User", String(userId));
		}
		const firstName = userRes.rows[0].first_name as string;

		const group = await newGroup(
			{ name: `${firstName}'s Household`, member_count: 1 },
			userId,
			c
		);

		await c.query(
			`INSERT INTO account_group_visibility (account_id, group_id)
			SELECT am.account_id, $1
			FROM account_members am
			WHERE am.user_id = $2
			ON CONFLICT (account_id, group_id) DO NOTHING`,
			[group.id, userId]
		);

		if (!useExternal) await c.query("COMMIT");
		return group;
	} catch (e) {
		if (!useExternal) await c.query("ROLLBACK");
		if (e instanceof NotFoundError || e instanceof DatabaseError) throw e;
		throw new DatabaseError("Failed to create personal group", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		if (!useExternal) c.release();
	}
};

// Get a user's membership in a group used for checking if creator
export const getMembership = async (
	groupId: number,
	userId: number
): Promise<GroupMembership | undefined> => {
	try {
		const res = await pool.query(
			`SELECT * FROM group_memberships
			WHERE group_id = $1 AND user_id = $2 AND departed_at IS NULL`,
			[groupId, userId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to fetch membership", {
			groupId,
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Get a user's single active membership across all groups
export const findActiveMembership = async (
	userId: number
): Promise<GroupMembership | undefined> => {
	try {
		const res = await pool.query(
			`SELECT * FROM group_memberships
			WHERE user_id = $1 AND departed_at IS NULL`,
			[userId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to fetch active membership", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// True when the user is in a real shared household (group with >1 active
// member, or where they are not the creator). Excludes their solo auto-group.
export const isInSharedHousehold = async (
	userId: number
): Promise<boolean> => {
	try {
		const res = await pool.query(
			`SELECT 1 FROM group_memberships gm
			  WHERE gm.user_id = $1
			    AND gm.departed_at IS NULL
			    AND (gm.role <> 'creator'
			         OR (SELECT COUNT(*) FROM group_memberships
			              WHERE group_id = gm.group_id AND departed_at IS NULL) > 1)`,
			[userId]
		);
		return res.rows.length > 0;
	} catch (e) {
		throw new DatabaseError("Failed to check household membership", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Soft-depart a member's group_memberships row. Used by leave and kick.
export const removeMember = async (
	groupId: number,
	userId: number,
	client?: PoolClient
): Promise<GroupMembership | undefined> => {
	const runner = client ?? pool;
	try {
		const res = await runner.query(
			`UPDATE group_memberships
			SET departed_at = NOW()
			WHERE group_id = $1 AND user_id = $2 AND departed_at IS NULL
			RETURNING *`,
			[groupId, userId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to remove member from group", {
			groupId,
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Drop the leaving/kicked user's accounts from the shared group's visibility
// so the household stops seeing their bank data after they depart.
export const unlinkUserAccountsFromGroup = async (
	userId: number,
	groupId: number,
	client?: PoolClient
): Promise<void> => {
	const runner = client ?? pool;
	try {
		await runner.query(
			`DELETE FROM account_group_visibility
			WHERE group_id = $1
			  AND account_id IN (
			    SELECT account_id FROM account_members WHERE user_id = $2
			  )`,
			[groupId, userId]
		);
	} catch (e) {
		throw new DatabaseError("Failed to unlink user's accounts from group", {
			groupId,
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Return all active member user_ids in a group (used before deleting the group
// so we can re-create personal groups for everyone).
export const listActiveMemberIds = async (
	groupId: number,
	client?: PoolClient
): Promise<number[]> => {
	const runner = client ?? pool;
	try {
		const res = await runner.query(
			`SELECT user_id FROM group_memberships
			WHERE group_id = $1 AND departed_at IS NULL`,
			[groupId]
		);
		return res.rows.map((r) => r.user_id as number);
	} catch (e) {
		throw new DatabaseError("Failed to list active members", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Atomically claim the sync lock for a group. Returns true if the lock was
// acquired, false if another sync is already running for this group.
export const claimGroupSync = async (groupId: number): Promise<boolean> => {
	try {
		const res = await pool.query(
			`UPDATE groups
			    SET is_syncing = TRUE, sync_started_at = NOW()
			  WHERE id = $1
			    AND is_syncing = FALSE
			  RETURNING id`,
			[groupId]
		);
		return (res.rowCount ?? 0) === 1;
	} catch (e) {
		throw new DatabaseError("Failed to claim group sync lock", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Release the sync lock and record completion time.
export const releaseGroupSync = async (groupId: number): Promise<void> => {
	try {
		await pool.query(
			`UPDATE groups
			    SET is_syncing = FALSE,
			        last_synced_at = NOW(),
			        sync_started_at = NULL
			  WHERE id = $1`,
			[groupId]
		);
	} catch (e) {
		throw new DatabaseError("Failed to release group sync lock", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Reset any locks older than 10 minutes — handles processes that crashed
// mid-sync and never released. Does not update last_synced_at so the group
// stays eligible for the next cron run.
export const resetStaleGroupLocks = async (): Promise<void> => {
	try {
		await pool.query(
			`UPDATE groups
			    SET is_syncing = FALSE, sync_started_at = NULL
			  WHERE is_syncing = TRUE
			    AND sync_started_at < NOW() - INTERVAL '10 minutes'`
		);
	} catch (e) {
		throw new DatabaseError("Failed to reset stale group sync locks", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Return all groups whose next sync falls within the next hour (i.e. last
// synced 7+ hours ago) and are not currently locked. NULL = never synced.
export const getGroupsDueForSync = async (): Promise<Group[]> => {
	try {
		const res = await pool.query(
			`SELECT * FROM groups
			  WHERE (last_synced_at IS NULL
			      OR last_synced_at + INTERVAL '7 hours' <= NOW())
			    AND is_syncing = FALSE`
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch groups due for sync", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Return the sync status fields for a single group (used by the dashboard).
export const getGroupSyncStatus = async (
	groupId: number
): Promise<{ last_synced_at: Date | null; is_syncing: boolean }> => {
	try {
		const res = await pool.query(
			`SELECT last_synced_at, is_syncing FROM groups WHERE id = $1`,
			[groupId]
		);
		const row = res.rows[0];
		return {
			last_synced_at: row?.last_synced_at ? new Date(row.last_synced_at) : null,
			is_syncing: row?.is_syncing ?? false,
		};
	} catch (e) {
		throw new DatabaseError("Failed to fetch group sync status", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Delete group part of a larger function in the services where it will check if you have membership of "creator" this is the atomic action
export const deleteGroup = async (
	groupId: number,
	client?: PoolClient
): Promise<Group | undefined> => {
	const runner = client ?? pool;
	try {
		const res = await runner.query(
			`DELETE FROM groups WHERE id = $1 RETURNING *`,
			[groupId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to delete group", {
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
