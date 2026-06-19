import { describe, it, expect, beforeEach } from "vitest";
import {
	truncateAll,
	seedUser,
	seedGroup,
	seedAccount,
	seedAccountMember,
	seedAccountGroupVisibility,
	seedTransaction,
	seedAccountTransaction,
	pool,
} from "../helpers/dbHelper.js";
import {
	addCoOwner,
	removeCoOwner,
	setAccountVisibility,
	markAccountJoint,
	deleteAccount,
	listAccountMembers,
} from "../../services/accountService.js";
import {
	getMyDashboardAccounts,
	getMyDashboardTransactions,
} from "../../repository/dashboardRepository.js";
import {
	AuthorizationError,
	ConflictError,
	ValidationError,
} from "../../errors/index.js";

// Adds an active group_memberships row so a second user belongs to an existing
// household (seedGroup only seeds the creator). Mirrors the join-via-invite end
// state without running the full invitation flow.
async function joinGroup(groupId: number, userId: number, role = "member") {
	await pool.query(
		`INSERT INTO group_memberships (group_id, user_id, role)
		 VALUES ($1, $2, $3)`,
		[groupId, userId, role]
	);
}

// A household of two users (A = creator/owner, B = member) plus one Plaid-style
// account owned by A and made visible to the group. Returns the ids in play.
async function seedHousehold() {
	const userA = await seedUser({ email: "a@example.com", username: "usera" });
	const group = await seedGroup(userA.id, { member_count: 2 });
	const userB = await seedUser({ email: "b@example.com", username: "userb" });
	await joinGroup(group.id, userB.id);

	const account = await seedAccount(userA.id, { plaid_account_id: "plaid_acct_1" });
	await seedAccountMember(account.id, userA.id, "owner");
	await seedAccountGroupVisibility(account.id, group.id);

	return { userA, userB, group, account };
}

describe("accountService co-ownership", () => {
	beforeEach(truncateAll);

	it("links a household member as a joint co-owner; they then see the account", async () => {
		const { userA, userB, group, account } = await seedHousehold();

		await addCoOwner(userA.id, account.id, group.id, userB.id);

		const members = await listAccountMembers(userA.id, account.id);
		expect(members.map((m) => m.user_id).sort()).toEqual(
			[userA.id, userB.id].sort()
		);
		const bMembership = members.find((m) => m.user_id === userB.id);
		expect(bMembership?.ownership_type).toBe("joint");

		// B now holds the account on their personal dashboard.
		const bAccounts = await getMyDashboardAccounts(userB.id, group.id);
		expect(bAccounts.map((a) => a.id)).toContain(account.id);
	});

	it("is idempotent — linking the same member twice keeps a single row", async () => {
		const { userA, userB, group, account } = await seedHousehold();
		await addCoOwner(userA.id, account.id, group.id, userB.id);
		await addCoOwner(userA.id, account.id, group.id, userB.id);

		const members = await listAccountMembers(userA.id, account.id);
		expect(members.filter((m) => m.user_id === userB.id)).toHaveLength(1);
	});

	it("refuses to link a user who is not in the caller's household", async () => {
		const { userA, group, account } = await seedHousehold();
		const outsider = await seedUser({ email: "c@example.com", username: "userc" });
		await seedGroup(outsider.id); // their own separate household

		await expect(
			addCoOwner(userA.id, account.id, group.id, outsider.id)
		).rejects.toThrow(AuthorizationError);
	});

	it("refuses co-owner management by a non-owner/joint caller", async () => {
		const { userB, group, account } = await seedHousehold();
		// B is only an authorized_user here.
		await seedAccountMember(account.id, userB.id, "authorized_user");
		const target = await seedUser({ email: "d@example.com", username: "userd" });
		await joinGroup(group.id, target.id);

		await expect(
			addCoOwner(userB.id, account.id, group.id, target.id)
		).rejects.toThrow(AuthorizationError);
	});

	it("removes a co-owner but refuses to remove the last owner", async () => {
		const { userA, userB, group, account } = await seedHousehold();
		await addCoOwner(userA.id, account.id, group.id, userB.id);

		await removeCoOwner(userA.id, account.id, userB.id);
		const members = await listAccountMembers(userA.id, account.id);
		expect(members.map((m) => m.user_id)).toEqual([userA.id]);

		// A is now the only owner — can't be removed.
		await expect(
			removeCoOwner(userA.id, account.id, userA.id)
		).rejects.toThrow(ConflictError);
	});
});

describe("accountService visibility (public/private)", () => {
	beforeEach(truncateAll);

	it("toggles an account between household-visible and private", async () => {
		const { userA, group, account } = await seedHousehold();

		// Starts public (seedHousehold shares it).
		let accounts = await getMyDashboardAccounts(userA.id, group.id);
		expect(accounts.find((a) => a.id === account.id)?.is_private).toBe(false);

		await setAccountVisibility(userA.id, account.id, group.id, "private");
		accounts = await getMyDashboardAccounts(userA.id, group.id);
		expect(accounts.find((a) => a.id === account.id)?.is_private).toBe(true);

		const visRows = await pool.query(
			"SELECT 1 FROM account_group_visibility WHERE account_id = $1 AND group_id = $2",
			[account.id, group.id]
		);
		expect(visRows.rowCount).toBe(0);

		await setAccountVisibility(userA.id, account.id, group.id, "group");
		accounts = await getMyDashboardAccounts(userA.id, group.id);
		expect(accounts.find((a) => a.id === account.id)?.is_private).toBe(false);
	});

	it("flags an account as user-declared joint", async () => {
		const { userA, group, account } = await seedHousehold();

		let accounts = await getMyDashboardAccounts(userA.id, group.id);
		expect(accounts.find((a) => a.id === account.id)?.is_joint_declared).toBe(false);

		await markAccountJoint(userA.id, account.id, true);
		accounts = await getMyDashboardAccounts(userA.id, group.id);
		expect(accounts.find((a) => a.id === account.id)?.is_joint_declared).toBe(true);
	});
});

describe("accountService.deleteAccount with co-owners (ownership transfer)", () => {
	beforeEach(truncateAll);

	async function ownershipType(accountId: number, userId: number) {
		const res = await pool.query(
			"SELECT ownership_type FROM account_members WHERE account_id = $1 AND user_id = $2",
			[accountId, userId]
		);
		return res.rows[0]?.ownership_type as string | undefined;
	}

	it("transfers to the sole co-owner and detaches the Plaid feed", async () => {
		const { userA, userB, group, account } = await seedHousehold();
		await addCoOwner(userA.id, account.id, group.id, userB.id);

		const result = await deleteAccount(userA.id, account.id);

		// Account survives, now owned by B, with Plaid ids cleared (manual account).
		expect(result.is_active).toBe(true);
		expect(result.plaid_account_id).toBeNull();
		expect(result.plaid_item_id).toBeNull();
		expect(result.user_id).toBe(userB.id);
		expect(await ownershipType(account.id, userB.id)).toBe("owner");
		expect(await ownershipType(account.id, userA.id)).toBeUndefined();
	});

	it("requires a chosen owner when multiple co-owners exist", async () => {
		const { userA, userB, group, account } = await seedHousehold();
		const userC = await seedUser({ email: "e@example.com", username: "usere" });
		await joinGroup(group.id, userC.id);
		await addCoOwner(userA.id, account.id, group.id, userB.id);
		await addCoOwner(userA.id, account.id, group.id, userC.id);

		// No pick → ValidationError carrying the candidate list.
		await expect(deleteAccount(userA.id, account.id)).rejects.toThrow(
			ValidationError
		);

		// Picking C transfers to C; B stays joint.
		const result = await deleteAccount(userA.id, account.id, userC.id);
		expect(result.user_id).toBe(userC.id);
		expect(await ownershipType(account.id, userC.id)).toBe("owner");
		expect(await ownershipType(account.id, userB.id)).toBe("joint");
		expect(await ownershipType(account.id, userA.id)).toBeUndefined();
	});

	it("soft-deletes when there are no co-owners", async () => {
		const { userA, account } = await seedHousehold();
		const result = await deleteAccount(userA.id, account.id);
		expect(result.is_active).toBe(false);
	});
});

describe("dashboard personal views are account-membership scoped", () => {
	beforeEach(truncateAll);

	it("a joint co-owner sees transactions authored by the other owner", async () => {
		const { userA, userB, group, account } = await seedHousehold();
		await addCoOwner(userA.id, account.id, group.id, userB.id);

		// A authors a transaction on the shared account.
		const txn = await seedTransaction(userA.id, {
			amount: -42,
			merchant_name: "Shared Groceries",
		});
		await seedAccountTransaction(account.id, txn.id, "debit");

		// B (joint) sees it on their personal feed even though t.user_id = A.
		const bFeed = await getMyDashboardTransactions(userB.id);
		expect(bFeed.map((t) => t.merchant_name)).toContain("Shared Groceries");

		// A sees it too.
		const aFeed = await getMyDashboardTransactions(userA.id);
		expect(aFeed.map((t) => t.merchant_name)).toContain("Shared Groceries");
	});

	it("does not leak transactions from accounts the user doesn't hold", async () => {
		const { userB } = await seedHousehold();
		// A separate user with their own private account + transaction.
		const other = await seedUser({ email: "z@example.com", username: "userz" });
		const otherAcct = await seedAccount(other.id);
		await seedAccountMember(otherAcct.id, other.id, "owner");
		const txn = await seedTransaction(other.id, { merchant_name: "Not Yours" });
		await seedAccountTransaction(otherAcct.id, txn.id, "credit");

		const bFeed = await getMyDashboardTransactions(userB.id);
		expect(bFeed.map((t) => t.merchant_name)).not.toContain("Not Yours");
	});
});
