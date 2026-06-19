import { pool } from "../config/database.js";
import { Tables, TablesInsert } from "../config/types.js";
import {
	DatabaseError,
	ConflictError,
	ValidationError,
} from "../errors/index.js";
import { isPostgresError } from "../utils/postgressError.js";

// ============================================
// Typing
// ============================================

type Account = Tables<"accounts">;
type AccountMember = Tables<"account_members">;

// ============================================
// Repository Functions
// ============================================

export const getAllAccounts = async (): Promise<Account[]> => {
	try {
		const res = await pool.query(
			"SELECT * FROM accounts WHERE is_active = true"
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch accounts", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// find account by ID
export const findById = async (
	accountId: number
): Promise<Account | undefined> => {
	try {
		const res = await pool.query("SELECT * FROM accounts WHERE id = $1", [
			accountId,
		]);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to fetch account", {
			accountId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Create a manually-entered account. Mirrors the Plaid ingestion path
// (insertPlaidAccount): in one transaction it inserts the account row, an
// account_members row making the creator the 'owner', and — when the creator
// has an active group — an account_group_visibility row so the account shows up
// on the dashboard. Without the membership + visibility rows the new account
// would be invisible (getMyDashboardAccounts joins account_members and the group
// views join account_group_visibility).
export const newAccount = async (
	accountData: TablesInsert<"accounts">,
	groupId?: number | null
): Promise<Account> => {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const res = await client.query(
			`INSERT INTO accounts (user_id, account_name, type, subtype, balance_current, balance_available, currency_code, institution_name, last_four, plaid_account_id, plaid_item_id, is_active)
			VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING *`,
			[
				accountData.user_id,
				accountData.account_name,
				accountData.type,
				accountData.subtype,
				accountData.balance_current,
				accountData.balance_available,
				accountData.currency_code,
				accountData.institution_name,
				accountData.last_four,
				accountData.plaid_account_id,
				accountData.plaid_item_id,
				accountData.is_active ?? true,
			]
		);
		const account: Account = res.rows[0];

		await client.query(
			`INSERT INTO account_members (account_id, user_id, ownership_type)
			VALUES ($1, $2, 'owner')`,
			[account.id, accountData.user_id]
		);

		if (groupId) {
			await client.query(
				`INSERT INTO account_group_visibility (account_id, group_id)
				VALUES ($1, $2)
				ON CONFLICT (account_id, group_id) DO NOTHING`,
				[account.id, groupId]
			);
		}

		await client.query("COMMIT");
		return account;
	} catch (e) {
		await client.query("ROLLBACK");
		if (isPostgresError(e)) {
			if (e.code === "23503") {
				throw new ConflictError("Referenced user does not exist", {
					constraint: e.constraint,
					detail: e.details,
				});
			}
			if (e.code === "23502") {
				throw new ValidationError("Missing column data", {
					constraint: e.constraint,
					detail: e.details,
				});
			}
		}
		throw new DatabaseError("Failed to create account", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}
};

// Update a manually-entered account. Guarded by `plaid_account_id IS NULL` in the
// WHERE clause so a Plaid-linked account can never be edited here (returns
// undefined if the row is Plaid-linked or doesn't exist). Fields are COALESCEd,
// so only the values actually sent are changed. Balances on Plaid accounts are
// owned by the sync feed; manual accounts have no feed, so editing them by hand
// is the only way they change.
export const updateManualAccount = async (
	accountId: number,
	data: {
		account_name?: string;
		type?: string | null;
		subtype?: string | null;
		institution_name?: string | null;
		last_four?: string | null;
		balance_current?: number | null;
	}
): Promise<Account | undefined> => {
	try {
		const res = await pool.query(
			`UPDATE accounts
				SET account_name = COALESCE($2, account_name),
				    type = COALESCE($3, type),
				    subtype = COALESCE($4, subtype),
				    institution_name = COALESCE($5, institution_name),
				    last_four = COALESCE($6, last_four),
				    balance_current = COALESCE($7, balance_current),
				    updated_at = NOW()
			WHERE id = $1 AND plaid_account_id IS NULL
			RETURNING *`,
			[
				accountId,
				data.account_name ?? null,
				data.type ?? null,
				data.subtype ?? null,
				data.institution_name ?? null,
				data.last_four ?? null,
				data.balance_current ?? null,
			]
		);
		return res.rows[0];
	} catch (e) {
		if (isPostgresError(e)) {
			if (e.code === "23502") {
				throw new ValidationError("Required field is missing", {
					column: e.column,
				});
			}
			if (e.code === "23514") {
				throw new ValidationError("Invalid account type", {
					constraint: e.constraint,
				});
			}
		}
		throw new DatabaseError("Failed to update account", {
			accountId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Soft delete - preserves transaction history. Sets is_active = false so the
// account drops out of the dashboard account lists (getMyDashboardAccounts /
// getGroupDashboardAccounts both filter is_active = true) while every
// transactions row stays intact for data integrity. For Plaid accounts this is
// also what stops future syncing: syncTransactions only links incoming
// transactions to accounts that are is_active = true.
export const deactivateAccount = async (
	accountId: number
): Promise<Account | undefined> => {
	try {
		const result = await pool.query(
			`UPDATE accounts
			SET is_active = false
			WHERE id = $1
			RETURNING *`,
			[accountId]
		);
		return result.rows[0];
	} catch (e) {
		if (isPostgresError(e)) {
			if (e.code === "23502") {
				throw new ValidationError("Required field is missing", {
					column: e.column,
				});
			}
		}

		throw new DatabaseError("Failed to deactivate account", {
			accountId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// for checking account membership access. (owner and joint can remove accounts)
export const getAccountMembership = async (
	userId: number,
	account_id: number
): Promise<AccountMember | undefined> => {
	try {
		const res = await pool.query(
			`SELECT * FROM account_members
			WHERE user_id = $1 AND account_id = $2`,
			[userId, account_id]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to fetch accessible accounts", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Whether an account has been shared into a given group's visibility. Used to
// authorize read access to an account the user doesn't personally hold but can
// see through their household.
export const isAccountVisibleToGroup = async (
	accountId: number,
	groupId: number
): Promise<boolean> => {
	try {
		const res = await pool.query(
			`SELECT 1 FROM account_group_visibility
			WHERE account_id = $1 AND group_id = $2
			LIMIT 1`,
			[accountId, groupId]
		);
		return (res.rowCount ?? 0) > 0;
	} catch (e) {
		throw new DatabaseError("Failed to check account visibility", {
			accountId,
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Make an account visible to a group. Idempotent via the unique constraint.
export const shareAccountWithGroup = async (
	accountId: number,
	groupId: number
): Promise<void> => {
	try {
		await pool.query(
			`INSERT INTO account_group_visibility (account_id, group_id)
			VALUES ($1, $2)
			ON CONFLICT (account_id, group_id) DO NOTHING`,
			[accountId, groupId]
		);
	} catch (e) {
		if (isPostgresError(e) && e.code === "23503") {
			throw new ConflictError(
				"Referenced account or group does not exist",
				{ constraint: e.constraint }
			);
		}
		throw new DatabaseError("Failed to share account with group", {
			accountId,
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Remove an account from a group's visibility.
export const unshareAccountFromGroup = async (
	accountId: number,
	groupId: number
): Promise<void> => {
	try {
		await pool.query(
			`DELETE FROM account_group_visibility
			WHERE account_id = $1 AND group_id = $2`,
			[accountId, groupId]
		);
	} catch (e) {
		throw new DatabaseError("Failed to unshare account from group", {
			accountId,
			groupId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Flag (or clear) an account as a user-declared joint account. This is a pure
// user assertion set during the linking session; it only drives whether the UI
// surfaces the invite/link-a-co-owner actions.
export const setAccountJoint = async (
	accountId: number,
	value: boolean
): Promise<Account | undefined> => {
	try {
		const res = await pool.query(
			`UPDATE accounts SET is_joint_declared = $2, updated_at = NOW()
			WHERE id = $1
			RETURNING *`,
			[accountId, value]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to update joint flag", {
			accountId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export type AccountMemberWithUser = AccountMember & {
	first_name: string;
	last_name: string;
};

// All members of an account (owner + joint + authorized_user), with the holder's
// name for the "manage co-owners" UI and the delete-transfer candidate picker.
export const getAccountMembers = async (
	accountId: number
): Promise<AccountMemberWithUser[]> => {
	try {
		const res = await pool.query(
			`SELECT am.*, u.first_name, u.last_name
			FROM account_members am
			JOIN users u ON u.id = am.user_id
			WHERE am.account_id = $1
			ORDER BY am.added_at ASC`,
			[accountId]
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch account members", {
			accountId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Attach a co-owner to an existing account (the de-dup path — the co-owner never
// re-links the bank via Plaid). Idempotent via the unique (account_id, user_id)
// constraint so a double-submit is a no-op.
export const addAccountMember = async (
	accountId: number,
	userId: number,
	ownershipType: "owner" | "joint" | "authorized_user" = "joint"
): Promise<void> => {
	try {
		await pool.query(
			`INSERT INTO account_members (account_id, user_id, ownership_type)
			VALUES ($1, $2, $3)
			ON CONFLICT (account_id, user_id) DO NOTHING`,
			[accountId, userId, ownershipType]
		);
	} catch (e) {
		if (isPostgresError(e) && e.code === "23503") {
			throw new ConflictError("Referenced account or user does not exist", {
				constraint: e.constraint,
			});
		}
		throw new DatabaseError("Failed to add account member", {
			accountId,
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Remove a co-owner from an account. Returns the number of rows removed so the
// service can distinguish "wasn't a member" from a successful removal.
export const removeAccountMember = async (
	accountId: number,
	userId: number
): Promise<number> => {
	try {
		const res = await pool.query(
			`DELETE FROM account_members WHERE account_id = $1 AND user_id = $2`,
			[accountId, userId]
		);
		return res.rowCount ?? 0;
	} catch (e) {
		throw new DatabaseError("Failed to remove account member", {
			accountId,
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Transfer ownership of an account from the deleting owner to a co-owner, in one
// transaction: promote the new owner to 'owner', drop the old owner's membership,
// and detach the account from the original linker's Plaid feed (null the Plaid
// ids) so it survives as a manual account for the new owner — history intact, but
// no longer auto-syncing under someone else's access token.
export const transferAccountOwnership = async (
	accountId: number,
	fromUserId: number,
	toUserId: number
): Promise<Account | undefined> => {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		await client.query(
			`UPDATE account_members SET ownership_type = 'owner'
			WHERE account_id = $1 AND user_id = $2`,
			[accountId, toUserId]
		);
		await client.query(
			`DELETE FROM account_members WHERE account_id = $1 AND user_id = $2`,
			[accountId, fromUserId]
		);
		const res = await client.query(
			`UPDATE accounts
			SET plaid_account_id = NULL, plaid_item_id = NULL, user_id = $2, updated_at = NOW()
			WHERE id = $1
			RETURNING *`,
			[accountId, toUserId]
		);

		await client.query("COMMIT");
		return res.rows[0];
	} catch (e) {
		await client.query("ROLLBACK");
		throw new DatabaseError("Failed to transfer account ownership", {
			accountId,
			fromUserId,
			toUserId,
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}
};
