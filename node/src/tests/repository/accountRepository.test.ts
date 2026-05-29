import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
	truncateAll,
	seedUser,
	seedAccount,
	seedGroup,
} from "../helpers/dbHelper.js";
import { seedPlaidItem } from "../helpers/plaidHelper.js";
import {
	getAllAccounts,
	findById,
	newAccount,
	deactivateAccount,
	getAccountMembership,
} from "../../repository/accountRepository.js";
import { ConflictError } from "../../errors/index.js";

describe("accountRepository", () => {
	// =========================================================================
	// getAllAccounts
	// =========================================================================

	describe("getAllAccounts", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should return empty array when no accounts exist", async () => {
			const accounts = await getAllAccounts();
			expect(accounts).toEqual([]);
		});

		it("should only return active accounts", async () => {
			const user = await seedUser();
			await seedAccount(user.id);
			await seedAccount(user.id, {
				account_name: "Inactive",
				is_active: false,
			});

			const accounts = await getAllAccounts();
			expect(accounts).toHaveLength(1);
			expect(accounts[0].account_name).toBe("Test Checking");
		});
	});

	// =========================================================================
	// findById
	// =========================================================================

	describe("findById", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should return the account by id", async () => {
			const user = await seedUser();
			const seeded = await seedAccount(user.id);

			const found = await findById(seeded.id);
			expect(found).toBeDefined();
			expect(found!.id).toBe(seeded.id);
			expect(found!.account_name).toBe("Test Checking");
		});

		it("should return undefined for non-existent id", async () => {
			const found = await findById(99999);
			expect(found).toBeUndefined();
		});
	});

	// =========================================================================
	// newAccount
	// =========================================================================

	describe("newAccount", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should create an account and return it", async () => {
			const user = await seedUser();

			const account = await newAccount({
				user_id: user.id,
				account_name: "My Savings",
				type: "depository",
				subtype: "savings",
				balance_current: 5000,
				balance_available: 5000,
				currency_code: "USD",
				institution_name: "Big Bank",
				last_four: "9876",
				plaid_account_id: "plaid_123",
				plaid_item_id: "item_456",
				is_active: true,
			});

			expect(account).toBeDefined();
			expect(account.account_name).toBe("My Savings");
			expect(account.type).toBe("depository");
			expect(account.subtype).toBe("savings");
			expect(Number(account.balance_current)).toBe(5000);
			expect(account.user_id).toBe(user.id);
		});

		it("should throw ConflictError for non-existent user_id", async () => {
			await expect(
				newAccount({
					user_id: 99999,
					account_name: "Ghost Account",
					type: "depository",
					subtype: "checking",
					balance_current: 0,
					balance_available: 0,
					currency_code: "USD",
					institution_name: "Bank",
					last_four: "0000",
					plaid_account_id: null,
					plaid_item_id: null,
					is_active: true,
				})
			).rejects.toThrow(ConflictError);
		});

		it("should default is_active to true", async () => {
			const user = await seedUser();

			const account = await newAccount({
				user_id: user.id,
				account_name: "Default Active",
				type: "depository",
				subtype: "checking",
				balance_current: 100,
				balance_available: 100,
				currency_code: "USD",
				institution_name: "Bank",
				last_four: "1111",
				plaid_account_id: null,
				plaid_item_id: null,
			});

			expect(account.is_active).toBe(true);
		});
	});

	// =========================================================================
	// deactivateAccount
	// =========================================================================

	describe("deactivateAccount", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should soft delete by setting is_active to false", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);

			const deactivated = await deactivateAccount(account.id);
			expect(deactivated).toBeDefined();
			expect(deactivated!.is_active).toBe(false);

			const all = await getAllAccounts();
			expect(all).toHaveLength(0);
		});

		it("should return undefined for non-existent account", async () => {
			const result = await deactivateAccount(99999);
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// getAccountMembership — not-found case
	// =========================================================================

	describe("getAccountMembership (direct seeds)", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should return undefined when no membership exists", async () => {
			const user = await seedUser();
			const membership = await getAccountMembership(user.id, 99999);
			expect(membership).toBeUndefined();
		});
	});

	// =========================================================================
	// Plaid integration — one item created for the whole block
	// =========================================================================

	describe("Plaid integration", () => {
		let userId: number;
		let plaidAccounts: Awaited<
			ReturnType<typeof seedPlaidItem>
		>["accounts"];

		beforeAll(async () => {
			await truncateAll();
			const user = await seedUser();
			const group = await seedGroup(user.id);
			const result = await seedPlaidItem(user.id, group.id);
			userId = user.id;
			plaidAccounts = result.accounts;
		});

		describe("getAccountMembership", () => {
			it("should return the membership record for a Plaid account", async () => {
				const target = plaidAccounts[0];
				const membership = await getAccountMembership(
					userId,
					target.id
				);
				expect(membership).toBeDefined();
				expect(membership!.ownership_type).toBe("owner");
			});
		});
	});
});
