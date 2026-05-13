import { pool } from "../../config/database.js";
import { newGroup } from "../../repository/groupRepository.js";

// All tables in dependency order (children first) for safe truncation
const ALL_TABLES = [
	"audit_log",
	"password_reset_tokens",
	"refresh_tokens",
	"invitations",
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
		account_type: "checking",
		balance_current: 1000.0,
		balance_available: 950.0,
		currency_code: "USD",
		institution_name: "Test Bank",
		last_four: "1234",
		is_active: true,
	};
	const data = { ...defaults, ...overrides };

	const res = await pool.query(
		`INSERT INTO accounts (user_id, account_name, account_type, balance_current, balance_available, currency_code, institution_name, last_four, is_active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING *`,
		[
			userId,
			data.account_name,
			data.account_type,
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

export { pool };
