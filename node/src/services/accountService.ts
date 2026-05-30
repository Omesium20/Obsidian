import {
	getAllAccounts,
	findById,
	newAccount,
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
	return account;
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
