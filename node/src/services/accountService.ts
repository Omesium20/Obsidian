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
	setAccountJoint,
	getAccountMembers,
	addAccountMember,
	removeAccountMember,
	transferAccountOwnership,
} from "../repository/accountRepository.js";
import {
	getAccountTransactionsPaged,
	type TxFilter,
} from "../repository/dashboardRepository.js";
import { getMembership } from "../repository/groupRepository.js";
import { upsertAccountSnapshot } from "../repository/balanceSnapshotRepository.js";
import { TablesInsert } from "../config/types.js";

import {
	NotFoundError,
	AuthorizationError,
	ValidationError,
	ConflictError,
} from "../errors/index.js";

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
// Shared owner/joint authorization gate. Loads the account (404 if missing) and
// the caller's membership (403 if absent or only authorized_user), returning the
// account so callers can use it.
const requireOwnerOrJoint = async (userId: number, accountId: number) => {
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
			"Only an owner or joint holder can perform this action"
		);
	}
	return account;
};

// Delete an account. Behavior depends on co-ownership:
//  - No joint co-owners: soft-delete (is_active = false) — history preserved, and
//    for Plaid accounts this also stops future syncing.
//  - Exactly one joint co-owner: transfer ownership to them and detach the Plaid
//    feed (the account lives on as a manual account for the new owner).
//  - More than one joint co-owner: the deleter must choose via newOwnerUserId. If
//    it's missing/invalid, throw a ValidationError carrying the candidate list so
//    the UI can prompt for a pick, then retry.
// Only an owner/joint holder may delete; authorized users cannot.
export const deleteAccount = async (
	userId: number,
	accountId: number,
	newOwnerUserId?: number
) => {
	await requireOwnerOrJoint(userId, accountId);

	const members = await getAccountMembers(accountId);
	const candidates = members.filter(
		(m) =>
			m.user_id !== userId &&
			(m.ownership_type === "owner" || m.ownership_type === "joint")
	);

	// No co-owner to hand off to → original soft-delete.
	if (candidates.length === 0) {
		const deleted = await deactivateAccount(accountId);
		if (!deleted) {
			throw new NotFoundError("Account", String(accountId));
		}
		return deleted;
	}

	// Pick the recipient: the sole co-owner, or the explicitly chosen one.
	let recipient = candidates[0];
	if (candidates.length > 1) {
		const chosen = candidates.find((m) => m.user_id === newOwnerUserId);
		if (!chosen) {
			throw new ValidationError(
				"This account has multiple co-owners — choose who should become the new owner.",
				{
					candidates: candidates.map((m) => ({
						user_id: m.user_id,
						first_name: m.first_name,
						last_name: m.last_name,
					})),
				}
			);
		}
		recipient = chosen;
	}

	const transferred = await transferAccountOwnership(
		accountId,
		userId,
		recipient.user_id
	);
	if (!transferred) {
		throw new NotFoundError("Account", String(accountId));
	}
	return transferred;
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

// Set an account's visibility to the caller's current household. "group" makes
// it visible to everyone in the household (a row in account_group_visibility);
// "private" removes it so only the holders see it on their personal dashboards.
// Default at link/create time is "group" (public). Only owners/joint may change it.
export const setAccountVisibility = async (
	userId: number,
	accountId: number,
	groupId: number,
	visibility: "private" | "group"
) => {
	await requireOwnerOrJoint(userId, accountId);
	if (visibility === "group") {
		await shareAccountWithGroup(accountId, groupId);
	} else {
		await unshareAccountFromGroup(accountId, groupId);
	}
};

// Flag (or clear) an account as a user-declared joint account. Surfaces the
// invite/link-a-co-owner actions in the UI. Owners/joint only.
export const markAccountJoint = async (
	userId: number,
	accountId: number,
	value: boolean
) => {
	await requireOwnerOrJoint(userId, accountId);
	const updated = await setAccountJoint(accountId, value);
	if (!updated) {
		throw new NotFoundError("Account", String(accountId));
	}
	return updated;
};

// List an account's members (holders) for the "manage co-owners" UI. Visible to
// any holder of the account.
export const listAccountMembers = async (userId: number, accountId: number) => {
	const account = await findById(accountId);
	if (!account) {
		throw new NotFoundError("Account", String(accountId));
	}
	const membership = await getAccountMembership(userId, accountId);
	if (!membership) {
		throw new AuthorizationError("No access to this account");
	}
	return getAccountMembers(accountId);
};

// Attach an existing household member to this account as a full joint co-owner —
// the de-dup core: the co-owner never re-links the bank via Plaid, they just gain
// access to this one account row. The caller must be an owner/joint holder, and
// the target must be an active member of the caller's current household.
export const addCoOwner = async (
	userId: number,
	accountId: number,
	groupId: number,
	targetUserId: number
) => {
	await requireOwnerOrJoint(userId, accountId);

	if (targetUserId === userId) {
		throw new ConflictError("You already hold this account.");
	}
	const targetMembership = await getMembership(groupId, targetUserId);
	if (!targetMembership) {
		throw new AuthorizationError(
			"You can only link accounts to members of your household."
		);
	}

	await addAccountMember(accountId, targetUserId, "joint");
};

// Remove a co-owner from an account. Owner/joint only; the sole remaining owner
// can't be removed (use delete/transfer instead).
export const removeCoOwner = async (
	userId: number,
	accountId: number,
	targetUserId: number
) => {
	await requireOwnerOrJoint(userId, accountId);

	const members = await getAccountMembers(accountId);
	const remainingOwners = members.filter(
		(m) =>
			m.user_id !== targetUserId &&
			(m.ownership_type === "owner" || m.ownership_type === "joint")
	);
	if (remainingOwners.length === 0) {
		throw new ConflictError(
			"Can't remove the last owner. Delete or transfer the account instead."
		);
	}

	const removed = await removeAccountMember(accountId, targetUserId);
	if (removed === 0) {
		throw new NotFoundError("Account member", String(targetUserId));
	}
};
