import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
	truncateAll,
	seedUser,
	seedAccount,
	seedAccountMember,
	seedTransaction,
	seedAccountTransaction,
	seedGroup,
} from "../helpers/dbHelper.js";
import { seedPlaidItem } from "../helpers/plaidHelper.js";
import {
	getAllTransactions,
	findById,
	newTransaction,
	deleteTransaction,
	getTransactionsWithAccounts,
} from "../../repository/transactionRepository.js";
import { ConflictError } from "../../errors/index.js";

describe("transactionRepository", () => {
	// =========================================================================
	// getAllTransactions
	// =========================================================================

	describe("getAllTransactions", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should return empty array when no transactions exist", async () => {
			const txns = await getAllTransactions();
			expect(txns).toEqual([]);
		});

		it("should return all transactions", async () => {
			const user = await seedUser();
			await seedTransaction(user.id, { description: "txn1" });
			await seedTransaction(user.id, { description: "txn2" });

			const txns = await getAllTransactions();
			expect(txns).toHaveLength(2);
		});
	});

	// =========================================================================
	// findById
	// =========================================================================

	describe("findById", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should return the transaction by id", async () => {
			const user = await seedUser();
			const txn = await seedTransaction(user.id);

			const found = await findById(txn.id);
			expect(found).toBeDefined();
			expect(found!.id).toBe(txn.id);
			expect(found!.description).toBe("Test transaction");
		});

		it("should return undefined for non-existent id", async () => {
			const found = await findById(99999);
			expect(found).toBeUndefined();
		});
	});

	// =========================================================================
	// newTransaction
	// =========================================================================

	describe("newTransaction", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should create a transaction and return it", async () => {
			const user = await seedUser();

			const txn = await newTransaction({
				user_id: user.id,
				amount: 125.5,
				description: "Grocery run",
				transaction_date: "2026-03-15",
				category: "groceries",
				merchant_name: "Whole Foods",
				plaid_id: null,
			});

			expect(txn).toBeDefined();
			expect(Number(txn.amount)).toBe(125.5);
			expect(txn.description).toBe("Grocery run");
			expect(txn.category).toBe("groceries");
			expect(txn.merchant_name).toBe("Whole Foods");
			expect(txn.user_id).toBe(user.id);
		});

		it("should throw ConflictError for non-existent user_id", async () => {
			await expect(
				newTransaction({
					user_id: 99999,
					amount: 10,
					description: "Ghost",
					transaction_date: "2026-01-01",
					category: "test",
					merchant_name: "Nowhere",
					plaid_id: null,
				})
			).rejects.toThrow(ConflictError);
		});
	});

	// =========================================================================
	// deleteTransaction
	// =========================================================================

	describe("deleteTransaction", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should delete and return the transaction", async () => {
			const user = await seedUser();
			const txn = await seedTransaction(user.id);

			const deleted = await deleteTransaction(txn.id);
			expect(deleted).toBeDefined();
			expect(deleted!.id).toBe(txn.id);

			const found = await findById(txn.id);
			expect(found).toBeUndefined();
		});

		it("should return undefined for non-existent transaction", async () => {
			const deleted = await deleteTransaction(99999);
			expect(deleted).toBeUndefined();
		});
	});

	// =========================================================================
	// getTransactionsWithAccounts — SQL behavior (direct seeds)
	// =========================================================================

	describe("getTransactionsWithAccounts (direct seeds)", () => {
		beforeEach(async () => {
			await truncateAll();
		});

		it("should order by transaction_date descending", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			const older = await seedTransaction(user.id, {
				transaction_date: "2026-01-01",
				description: "January",
			});
			const newer = await seedTransaction(user.id, {
				transaction_date: "2026-06-15",
				description: "June",
			});
			await seedAccountTransaction(account.id, older.id);
			await seedAccountTransaction(account.id, newer.id);

			const results = await getTransactionsWithAccounts(user.id);
			expect(results).toHaveLength(2);
			expect(results[0].description).toBe("June");
			expect(results[1].description).toBe("January");
		});

		it("should respect limit and offset", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			for (let i = 1; i <= 5; i++) {
				const txn = await seedTransaction(user.id, {
					transaction_date: `2026-0${i}-01`,
					description: `txn${i}`,
				});
				await seedAccountTransaction(account.id, txn.id);
			}

			// Ordered DESC: txn5, txn4, [txn3, txn2], txn1
			const page = await getTransactionsWithAccounts(user.id, 2, 2);
			expect(page).toHaveLength(2);
			expect(page[0].description).toBe("txn3");
			expect(page[1].description).toBe("txn2");
		});

		it("should return empty array when no linked transactions exist", async () => {
			const user = await seedUser();
			const results = await getTransactionsWithAccounts(user.id);
			expect(results).toEqual([]);
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

		describe("getTransactionsWithAccounts", () => {
			it("should return transactions joined with Plaid account info", async () => {
				const results = await getTransactionsWithAccounts(userId);
				expect(results.length).toBeGreaterThan(0);
				expect(results[0].account_name).toBeDefined();
				expect(results[0].institution_name).toBeDefined();

				const accountNames = new Set(plaidAccounts.map((a) => a.account_name));
				expect(
					results.every((r) => accountNames.has(r.account_name))
				).toBe(true);
			});
		});
	});
});
