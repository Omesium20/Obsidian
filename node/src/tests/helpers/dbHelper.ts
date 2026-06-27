import { pool } from "../../config/database.js";
import { newGroup } from "../../repository/groupRepository.js";

// All tables in dependency order (children first) for safe truncation
const ALL_TABLES = [
	"audit_log",
	"password_reset_tokens",
	"refresh_tokens",
	"invitations",
	"account_balance_snapshots",
	"account_transactions",
	"account_members",
	"account_group_visibility",
	"group_memberships",
	"plaid_items",
	"transactions",
	"accounts",
	"groups",
	"users",
];

/**
 * Truncates all tables with CASCADE, resetting sequences.
 * Call this in beforeEach to ensure every test starts with a clean database.
 */
export async function truncateAll() {
	await pool.query(
		`TRUNCATE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`
	);
}

/**
 * Inserts a test user and returns the created row.
 * Most repositories need a user to exist due to foreign key constraints.
 */
export async function seedUser(overrides: Record<string, unknown> = {}) {
	const defaults = {
		email: "test@example.com",
		username: "testuser",
		password_hash: "hashed_password_placeholder",
		first_name: "Test",
		last_name: "User",
	};
	const data = { ...defaults, ...overrides };

	const res = await pool.query(
		`INSERT INTO users (email, username, password_hash, first_name, last_name)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING *`,
		[data.email, data.username, data.password_hash, data.first_name, data.last_name]
	);
	return res.rows[0];
}

/**
 * Inserts a test account linked to a user and returns the created row.
 */
export async function seedAccount(
	userId: number,
	overrides: Record<string, unknown> = {}
) {
	const defaults = {
		account_name: "Test Checking",
		type: "depository",
		subtype: "checking",
		balance_current: 1000.0,
		balance_available: 950.0,
		currency_code: "USD",
		institution_name: "Test Bank",
		last_four: "1234",
		is_active: true,
	};
	const data = { ...defaults, ...overrides };

	const res = await pool.query(
		`INSERT INTO accounts (user_id, account_name, type, subtype, balance_current, balance_available, currency_code, institution_name, last_four, is_active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING *`,
		[
			userId,
			data.account_name,
			data.type,
			data.subtype,
			data.balance_current,
			data.balance_available,
			data.currency_code,
			data.institution_name,
			data.last_four,
			data.is_active,
		]
	);
	return res.rows[0];
}

/**
 * Inserts a balance snapshot row with an explicit date, for building net-worth
 * series fixtures across months. upsertAccountSnapshot only ever writes today's
 * row, so tests that need past months insert directly here.
 */
export async function seedBalanceSnapshot(
	accountId: number,
	balance: number,
	snapshotDate: string
) {
	const res = await pool.query(
		`INSERT INTO account_balance_snapshots (account_id, balance, snapshot_date)
		 VALUES ($1, $2, $3)
		 RETURNING *`,
		[accountId, balance, snapshotDate]
	);
	return res.rows[0];
}

/**
 * Makes an account visible to a group (account_group_visibility), so the
 * group-scoped net-worth/dashboard queries pick it up.
 */
export async function seedAccountGroupVisibility(accountId: number, groupId: number) {
	const res = await pool.query(
		`INSERT INTO account_group_visibility (account_id, group_id)
		 VALUES ($1, $2)
		 ON CONFLICT (account_id, group_id) DO NOTHING
		 RETURNING *`,
		[accountId, groupId]
	);
	return res.rows[0];
}

/**
 * Inserts an account_members row linking a user to an account.
 */
export async function seedAccountMember(
	accountId: number,
	userId: number,
	ownershipType: "owner" | "joint" | "authorized_user" = "owner"
) {
	const res = await pool.query(
		`INSERT INTO account_members (account_id, user_id, ownership_type)
		 VALUES ($1, $2, $3)
		 RETURNING *`,
		[accountId, userId, ownershipType]
	);
	return res.rows[0];
}

/**
 * Inserts a test transaction linked to a user and returns the created row.
 */
export async function seedTransaction(
	userId: number,
	overrides: Record<string, unknown> = {}
) {
	const defaults = {
		amount: 50.0,
		description: "Test transaction",
		transaction_date: "2026-01-15",
		category: "groceries",
		merchant_name: "Test Store",
	};
	const data = { ...defaults, ...overrides };

	const res = await pool.query(
		`INSERT INTO transactions (user_id, amount, description, transaction_date, category, merchant_name)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING *`,
		[
			userId,
			data.amount,
			data.description,
			data.transaction_date,
			data.category,
			data.merchant_name,
		]
	);
	return res.rows[0];
}

/**
 * Links a transaction to an account via account_transactions.
 */
export async function seedAccountTransaction(
	accountId: number,
	transactionId: number,
	transactionType: "debit" | "credit" | "transfer" = "debit"
) {
	const res = await pool.query(
		`INSERT INTO account_transactions (account_id, transaction_id, transaction_type)
		 VALUES ($1, $2, $3)
		 RETURNING *`,
		[accountId, transactionId, transactionType]
	);
	return res.rows[0];
}

/**
 * Creates a group with the given user as creator and returns the group row.
 * Required before calling seedPlaidItem — exchangePublicToken needs a groupId
 * to insert account_group_visibility rows.
 */
export async function seedGroup(
	userId: number,
	overrides: Record<string, unknown> = {}
) {
	const defaults = { name: "Test Group", member_count: 2 };
	const data = { ...defaults, ...overrides };
	return newGroup(
		{ name: String(data.name), member_count: Number(data.member_count) },
		userId
	);
}

/**
 * Inserts an audit_log row and returns it. Defaults to a minimal system-sourced
 * INSERT on `accounts`; override any column. `changed_at` (export ordering) and
 * `exported_at` (shipped marker) are the two most useful overrides — pass an ISO
 * string to pin them. When `changed_at` is omitted the column default (NOW())
 * applies.
 */
export async function seedAuditLog(overrides: Record<string, unknown> = {}) {
	const defaults: Record<string, unknown> = {
		user_id: null,
		group_id: null,
		table_name: "accounts",
		record_id: 1,
		operation: "INSERT",
		old_data: null,
		new_data: null,
		action_source: "system",
		exported_at: null,
	};
	const data = { ...defaults, ...overrides };

	const columns = [
		"user_id",
		"group_id",
		"table_name",
		"record_id",
		"operation",
		"old_data",
		"new_data",
		"action_source",
		"exported_at",
	];
	const values: unknown[] = columns.map((c) => data[c]);

	// changed_at drives claim ordering. Only insert it explicitly when a test
	// pins it; otherwise let the DB default (NOW()) apply.
	if (overrides.changed_at !== undefined) {
		columns.push("changed_at");
		values.push(overrides.changed_at);
	}

	const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
	const res = await pool.query(
		`INSERT INTO audit_log (${columns.join(", ")})
		 VALUES (${placeholders})
		 RETURNING *`,
		values
	);
	return res.rows[0];
}

export { pool };
