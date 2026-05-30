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

// Soft delete - preserves transaction history
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
