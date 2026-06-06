import {
	getAllAccounts,
	findById,
	newAccount,
	updateManualAccount,
	deactivateAccount,
	getAccountMembership,
	isAccountVisibleToGroup,
	shareAccountWithGroup,
	unshareAccountFromGroup,
} from "../repository/accountRepository.js";
import {
	getAccountTransactionsPaged,
	type TxFilter,
} from "../repository/dashboardRepository.js";
import { upsertAccountSnapshot } from "../repository/balanceSnapshotRepository.js";
import { TablesInsert } from "../config/types.js";

import { NotFoundError, AuthorizationError } from "../errors/index.js";

const ACCOUNT_TX_PAGE_LIMIT = 25;

// Get all accounts
export const getAccounts = async () => {
	const accounts = await getAllAccounts();
	return accounts;
};

// Get account by ID — only accessible to account members
export const getAccountById = async (userId: number, accountId: number) => {
	const account = await findById(accountId);
	if (!account) {
		throw new NotFoundError("Account", String(accountId));
	}

	const membership = await getAccountMembership(userId, accountId);
	if (!membership) {
		throw new AuthorizationError("No access to this account");
	}

	return account;
};

// List a single account's transactions (paginated). Access is granted if the
// user is a member of the account OR the account is shared with their current
// group — the same accounts they can already see on the dashboard.
export const getAccountTransactions = async (
	userId: number,
	groupId: number | null | undefined,
	accountId: number,
	page: number,
	filter: TxFilter
) => {
	const account = await findById(accountId);
	if (!account) {
		throw new NotFoundError("Account", String(accountId));
	}

	const membership = await getAccountMembership(userId, accountId);
	const visible = groupId
		? await isAccountVisibleToGroup(accountId, groupId)
		: false;
	if (!membership && !visible) {
		throw new AuthorizationError("No access to this account");
	}

	const { transactions, total } = await getAccountTransactionsPaged(
		accountId,
		page,
		ACCOUNT_TX_PAGE_LIMIT,
		filter
	);
	return {
		transactions,
		total,
		page,
		pages: Math.max(1, Math.ceil(total / ACCOUNT_TX_PAGE_LIMIT)),
	};
};

// Create a new account. Passes the creator's active group so the repository can
// make the account visible on the household dashboard (alongside the owner
// account_members row it always writes).
export const createAccount = async (
	accountData: TablesInsert<"accounts">,
	groupId?: number | null
) => {
	const account = await newAccount(accountData, groupId);
	// Seed the net-worth series with the opening balance (best-effort).
	await snapshotBalance(account.id, account.balance_current);
	return account;
};

// Record a balance snapshot without letting a failure break the account
// mutation that triggered it — the net-worth series is non-critical.
const snapshotBalance = async (accountId: number, balance: number | null) => {
	try {
		await upsertAccountSnapshot(accountId, balance);
	} catch (e) {
		console.warn("[accountService] balance snapshot failed", {
			accountId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Update a manually-entered account. Only an owner or joint holder may edit, and
// only manual accounts are editable — Plaid-linked accounts are owned by the sync
// feed and would be overwritten on the next sync.
export const updateAccount = async (
	userId: number,
	accountId: number,
	data: {
		account_name?: string;
		type?: string | null;
		subtype?: string | null;
		institution_name?: string | null;
		last_four?: string | null;
		balance_current?: number | null;
	}
) => {
	const account = await findById(accountId);
	if (!account) {
		throw new NotFoundError("Account", String(accountId));
	}

	const membership = await getAccountMembership(userId, accountId);
	if (!membership) {
		throw new AuthorizationError("No access to this account");
	}
	if (
		membership.ownership_type !== "owner" &&
		membership.ownership_type !== "joint"
	) {
		throw new AuthorizationError("Only the account owner can edit this account");
	}
	if (account.plaid_account_id !== null) {
		throw new AuthorizationError(
			"Only manually-added accounts can be edited"
		);
	}

	const updated = await updateManualAccount(accountId, data);
	if (!updated) {
		throw new NotFoundError("Account", String(accountId));
	}
	// Capture the edited balance so the net-worth line steps on manual changes.
	await snapshotBalance(updated.id, updated.balance_current);
	return updated;
};

// Remove an account from the dashboard. This is a soft delete (is_active =
// false), not a hard delete: the account row and all of its transaction history
// are preserved for data integrity, the account simply stops appearing in the
// account lists. Works for both manual and Plaid accounts — for Plaid accounts
// it additionally stops future syncing, because syncTransactions only writes
// transactions for accounts that are still is_active. Only an owner or joint
// holder may remove an account; authorized users cannot.
export const deleteAccount = async (userId: number, accountId: number) => {
	const account = await findById(accountId);
	if (!account) {
		throw new NotFoundError("Account", String(accountId));
	}

	const membership = await getAccountMembership(userId, accountId);
	if (!membership) {
		throw new AuthorizationError("No access to this account");
	}
	if (
		membership.ownership_type !== "owner" &&
		membership.ownership_type !== "joint"
	) {
		throw new AuthorizationError(
			"Only the account owner can delete this account"
		);
	}

	const deleted = await deactivateAccount(accountId);
	if (!deleted) {
		throw new NotFoundError("Account", String(accountId));
	}
	return deleted;
};

// Deactivate account. Keeps account but is no longer visible and keeps history
export const removeAccount = async (user_id: number, account_id: number) => {
	const exists = await findById(account_id);
	if (!exists) {
		throw new NotFoundError("Account", String(account_id));
	}

	const membership = await getAccountMembership(user_id, account_id);
	if (!membership) {
		throw new AuthorizationError("No access to this account");
	}
	if (membership.ownership_type === "authorized_user") {
		throw new AuthorizationError(
			"Authorized users cannot modify this account"
		);
	}

	const account = await deactivateAccount(account_id);
	return account;
};

// Share an account with the caller's current group. Only owners or joint
// owners can broadcast an account to the household — authorized users can't.
export const shareAccount = async (
	userId: number,
	accountId: number,
	groupId: number
) => {
	const exists = await findById(accountId);
	if (!exists) {
		throw new NotFoundError("Account", String(accountId));
	}

	const membership = await getAccountMembership(userId, accountId);
	if (!membership) {
		throw new AuthorizationError("No access to this account");
	}
	if (
		membership.ownership_type !== "owner" &&
		membership.ownership_type !== "joint"
	) {
		throw new AuthorizationError(
			"Only the account owner can share this account"
		);
	}

	await shareAccountWithGroup(accountId, groupId);
};

// Unshare an account from the caller's current group. Same access rules as share.
export const unshareAccount = async (
	userId: number,
	accountId: number,
	groupId: number
) => {
	const exists = await findById(accountId);
	if (!exists) {
		throw new NotFoundError("Account", String(accountId));
	}

	const membership = await getAccountMembership(userId, accountId);
	if (!membership) {
		throw new AuthorizationError("No access to this account");
	}
	if (
		membership.ownership_type !== "owner" &&
		membership.ownership_type !== "joint"
	) {
		throw new AuthorizationError(
			"Only the account owner can unshare this account"
		);
	}

	await unshareAccountFromGroup(accountId, groupId);
};
