import { PoolClient } from "pg";
import { pool } from "../config/database.js";
import { Tables } from "../config/types.js";
import { DatabaseError } from "../errors/index.js";
import { decryptToken, EncryptedToken } from "../utils/plaidCrypto.js";

type PlaidItem = Tables<"plaid_items">;

interface InsertPlaidItemArgs {
	userId: number;
	plaidItemId: string;
	institutionId: string | null;
	institutionName: string | null;
	encryptedAccessToken: EncryptedToken;
}

interface InsertPlaidAccountArgs {
	userId: number;
	groupId: number;
	accountName: string;
	accountType: string;
	plaidType: string | null;
	plaidSubtype: string | null;
	institutionName: string | null;
	lastFour: string | null;
	plaidAccountId: string;
	plaidItemId: string;
	balanceCurrent: number | null;
	balanceAvailable: number | null;
	currencyCode: string;
}

// Insert a new plaid_items row. Accepts an optional client to participate in a
// caller-managed transaction; falls back to the shared pool otherwise.
export const insertPlaidItem = async (
	args: InsertPlaidItemArgs,
	client?: PoolClient
): Promise<PlaidItem> => {
	const executor = client ?? pool;
	try {
		const res = await executor.query(
			`INSERT INTO plaid_items
				(user_id, plaid_item_id, institution_id, institution_name,
				 access_token_ciphertext, access_token_iv, access_token_tag)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 RETURNING *`,
			[
				args.userId,
				args.plaidItemId,
				args.institutionId,
				args.institutionName,
				args.encryptedAccessToken.ciphertext,
				args.encryptedAccessToken.iv,
				args.encryptedAccessToken.tag,
			]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to insert plaid_item", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export const insertPlaidAccount = async (
	args: InsertPlaidAccountArgs,
	client?: PoolClient
): Promise<number> => {
	const useExternal = client !== undefined;
	const c = client ?? (await pool.connect());
	try {
		if (!useExternal) await c.query("BEGIN");

		const accountRes = await c.query(
			`INSERT INTO accounts
				(user_id, account_name, account_type, plaid_type, plaid_subtype,
				 institution_name, last_four, plaid_account_id, plaid_item_id,
				 balance_current, balance_available, currency_code, is_active)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
			 RETURNING id`,
			[
				args.userId,
				args.accountName,
				args.accountType,
				args.plaidType,
				args.plaidSubtype,
				args.institutionName,
				args.lastFour,
				args.plaidAccountId,
				args.plaidItemId,
				args.balanceCurrent,
				args.balanceAvailable,
				args.currencyCode,
			]
		);
		const accountRowId: number = accountRes.rows[0].id;

		await c.query(
			`INSERT INTO account_members (account_id, user_id, ownership_type)
			 VALUES ($1, $2, 'owner')`,
			[accountRowId, args.userId]
		);

		await c.query(
			`INSERT INTO account_group_visibility (account_id, group_id)
			 VALUES ($1, $2)`,
			[accountRowId, args.groupId]
		);

		if (!useExternal) await c.query("COMMIT");
		return accountRowId;
	} catch (e) {
		if (!useExternal) await c.query("ROLLBACK");
		throw new DatabaseError("Failed to insert plaid account", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		if (!useExternal) c.release();
	}
};

export const updateCursor = async (
	id: number,
	cursor: string
): Promise<void> => {
	try {
		await pool.query(
			`UPDATE plaid_items
			    SET transactions_cursor = $1,
			        last_synced_at = NOW()
			  WHERE id = $2`,
			[cursor, id]
		);
	} catch (e) {
		throw new DatabaseError("Failed to update transactions_cursor", {
			id,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export const findByGroupMembers = async (
	groupId: number
): Promise<PlaidItem[]> => {
	try {
		const res = await pool.query(
			`SELECT pi.*
			   FROM plaid_items pi
			   JOIN group_memberships gm ON gm.user_id = pi.user_id
			  WHERE gm.group_id = $1
			    AND gm.departed_at IS NULL
			  ORDER BY pi.id`,
			[groupId]
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError(
			"Failed to fetch plaid_items for group members",
			{
				groupId,
				cause: e instanceof Error ? e.message : String(e),
			}
		);
	}
};

export const getDecryptedAccessToken = (item: PlaidItem): string => {
	return decryptToken({
		ciphertext: item.access_token_ciphertext,
		iv: item.access_token_iv,
		tag: item.access_token_tag,
	});
};
