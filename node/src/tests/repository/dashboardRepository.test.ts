import { describe, it, expect, beforeEach } from "vitest";
import {
	truncateAll,
	seedUser,
	seedGroup,
	seedAccount,
	seedAccountMember,
	seedTransaction,
	seedAccountTransaction,
	seedAccountGroupVisibility,
} from "../helpers/dbHelper.js";
import {
	getMyTransactionsPaged,
	getGroupTransactionsPaged,
	getMemberTransactionsPaged,
	getMyTransactionCategories,
	getGroupTransactionCategories,
	getMemberTransactionCategories,
} from "../../repository/dashboardRepository.js";

// Inserts a transaction owned by `userId` and links it to `accountId` so it shows
// up in the paged queries (which all JOIN account_transactions). Amounts follow
// the app convention: positive = inflow, negative = outflow.
async function seedTx(
	userId: number,
	accountId: number,
	overrides: {
		amount: number;
		category?: string | null;
		transaction_date?: string;
		merchant_name?: string;
		description?: string;
	}
) {
	const tx = await seedTransaction(userId, {
		amount: overrides.amount,
		category: overrides.category ?? null,
		transaction_date: overrides.transaction_date ?? "2026-01-15",
		...(overrides.merchant_name !== undefined ? { merchant_name: overrides.merchant_name } : {}),
		...(overrides.description !== undefined ? { description: overrides.description } : {}),
	});
	await seedAccountTransaction(
		accountId,
		tx.id,
		overrides.amount >= 0 ? "credit" : "debit"
	);
	return tx;
}

// YYYY-MM-DD from local date components (no UTC conversion, so the day never
// shifts across the month boundary the way Date.toISOString() can).
function iso(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

// First day of the current calendar month — always inside the "month" range.
function thisMonthISO(): string {
	const d = new Date();
	d.setDate(1);
	return iso(d);
}

// A date `n` whole months before today, pinned to the 15th so it stays mid-month
// (valid in every month, no boundary rounding) and matches the server's
// CURRENT_DATE - INTERVAL 'n months' comparisons.
function monthsAgoISO(n: number): string {
	const d = new Date();
	d.setDate(15);
	d.setMonth(d.getMonth() - n);
	return iso(d);
}

// "YYYY-MM" key matching the server's TO_CHAR(month_start, 'YYYY-MM').
function monthKeyOf(isoDate: string): string {
	return isoDate.slice(0, 7);
}

describe("dashboardRepository — transaction list", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	// ============================================
	// getMyTransactionsPaged — category filter
	// ============================================

	describe("getMyTransactionsPaged category filter", () => {
		it("returns only transactions matching the requested category", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			await seedTx(user.id, account.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, account.id, { amount: -30, category: "groceries" });
			await seedTx(user.id, account.id, { amount: 1000, category: "salary" });
			await seedTx(user.id, account.id, { amount: -20, category: "dining" });

			const result = await getMyTransactionsPaged(user.id, 1, 25, "all", "groceries");

			expect(result.total).toBe(2);
			expect(result.transactions).toHaveLength(2);
			expect(result.transactions.every((t) => t.category === "groceries")).toBe(true);
		});

		it("selects uncategorized rows when category is 'Other'", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			await seedTx(user.id, account.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, account.id, { amount: -10, category: null });

			const result = await getMyTransactionsPaged(user.id, 1, 25, "all", "Other");

			expect(result.total).toBe(1);
			expect(result.transactions).toHaveLength(1);
			expect(result.transactions[0].category).toBeNull();
		});

		it("returns every transaction when no category is given", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			await seedTx(user.id, account.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, account.id, { amount: 1000, category: "salary" });
			await seedTx(user.id, account.id, { amount: -20, category: "dining" });

			const result = await getMyTransactionsPaged(user.id, 1, 25, "all");

			expect(result.total).toBe(3);
		});

		it("combines the category filter with the income/spend filter", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			// Two groceries outflows plus a groceries refund (inflow under the same
			// category) — the spend filter must drop the refund.
			await seedTx(user.id, account.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, account.id, { amount: -30, category: "groceries" });
			await seedTx(user.id, account.id, { amount: 15, category: "groceries" });

			const result = await getMyTransactionsPaged(user.id, 1, 25, "spend", "groceries");

			expect(result.total).toBe(2);
			expect(result.transactions.every((t) => Number(t.amount) < 0)).toBe(true);
		});
	});

	// ============================================
	// getMyTransactionsPaged — is_private flag
	// ============================================

	describe("getMyTransactionsPaged is_private flag", () => {
		it("flags transactions on accounts not shared with the viewer's group, and not those that are", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			const shared = await seedAccount(user.id, { account_name: "Shared" });
			const privateAcct = await seedAccount(user.id, { account_name: "Private" });
			await seedAccountMember(shared.id, user.id, "owner");
			await seedAccountMember(privateAcct.id, user.id, "owner");
			// Only the shared account has a visibility row for the group.
			await seedAccountGroupVisibility(shared.id, group.id);

			await seedTx(user.id, shared.id, { amount: -50, merchant_name: "Shared Tx" });
			await seedTx(user.id, privateAcct.id, { amount: -25, merchant_name: "Private Tx" });

			const result = await getMyTransactionsPaged(
				user.id, 1, 25, "all", undefined, "all", undefined, group.id
			);

			const byMerchant = Object.fromEntries(
				result.transactions.map((t) => [t.merchant_name, t.is_private])
			);
			expect(byMerchant["Shared Tx"]).toBe(false);
			expect(byMerchant["Private Tx"]).toBe(true);
		});

		it("never flags rows as private when no group context is passed", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");
			await seedTx(user.id, account.id, { amount: -50 });

			const result = await getMyTransactionsPaged(user.id, 1, 25, "all");

			expect(result.transactions.every((t) => t.is_private === false)).toBe(true);
		});
	});

	// ============================================
	// getMyTransactionsPaged — full-set summary
	// ============================================

	describe("getMyTransactionsPaged summary aggregates", () => {
		it("computes Money in / out / counts over the whole filtered set, not just the page", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			// 3 inflows (+100 each) and 3 outflows (−40 each) = 6 rows.
			for (let i = 0; i < 3; i++) {
				await seedTx(user.id, account.id, { amount: 100, category: "salary" });
				await seedTx(user.id, account.id, { amount: -40, category: "dining" });
			}

			// Page size of 2 forces pagination, yet the summary must cover all 6 rows.
			const result = await getMyTransactionsPaged(user.id, 1, 2, "all");

			expect(result.transactions).toHaveLength(2); // just the page
			expect(result.total).toBe(6);
			expect(result.sumIn).toBe(300);
			expect(result.sumOut).toBe(120); // positive magnitude
			expect(result.countIn).toBe(3);
			expect(result.countOut).toBe(3);
		});

		it("respects the category filter in the summary aggregates", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			await seedTx(user.id, account.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, account.id, { amount: -30, category: "groceries" });
			await seedTx(user.id, account.id, { amount: -20, category: "dining" });
			await seedTx(user.id, account.id, { amount: 1000, category: "salary" });

			const result = await getMyTransactionsPaged(user.id, 1, 25, "all", "groceries");

			expect(result.sumIn).toBe(0);
			expect(result.sumOut).toBe(80);
			expect(result.countIn).toBe(0);
			expect(result.countOut).toBe(2);
		});

		it("returns zeroed aggregates when nothing matches", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			const result = await getMyTransactionsPaged(user.id, 1, 25, "all", "nonexistent");

			expect(result.total).toBe(0);
			expect(result.sumIn).toBe(0);
			expect(result.sumOut).toBe(0);
			expect(result.countIn).toBe(0);
			expect(result.countOut).toBe(0);
		});
	});

	// ============================================
	// getMyTransactionCategories
	// ============================================

	describe("getMyTransactionCategories", () => {
		it("returns distinct categories sorted, with null bucketed as 'Other'", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			await seedTx(user.id, account.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, account.id, { amount: -30, category: "groceries" });
			await seedTx(user.id, account.id, { amount: -20, category: "dining" });
			await seedTx(user.id, account.id, { amount: -10, category: null });

			const categories = await getMyTransactionCategories(user.id);

			// Sorted with JS so the assertion doesn't depend on Postgres's locale
			// collation; the repository's contract is the distinct set (null → Other).
			expect([...categories].sort()).toEqual(["Other", "dining", "groceries"]);
		});

		it("does not include another user's categories", async () => {
			const user = await seedUser();
			const other = await seedUser({ email: "other@example.com", username: "other" });
			const myAccount = await seedAccount(user.id);
			const otherAccount = await seedAccount(other.id, { last_four: "5678" });
			await seedAccountMember(myAccount.id, user.id, "owner");
			await seedAccountMember(otherAccount.id, other.id, "owner");

			await seedTx(user.id, myAccount.id, { amount: -50, category: "groceries" });
			await seedTx(other.id, otherAccount.id, { amount: -50, category: "travel" });

			const categories = await getMyTransactionCategories(user.id);

			expect(categories).toEqual(["groceries"]);
		});
	});

	// ============================================
	// getGroupTransactionsPaged — visibility + category
	// ============================================

	describe("getGroupTransactionsPaged", () => {
		it("filters by category within accounts shared with the group", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			const shared = await seedAccount(user.id);
			await seedAccountMember(shared.id, user.id, "owner");
			await seedAccountGroupVisibility(shared.id, group.id);

			await seedTx(user.id, shared.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, shared.id, { amount: -25, category: "groceries" });
			await seedTx(user.id, shared.id, { amount: -10, category: "dining" });

			const result = await getGroupTransactionsPaged(group.id, 1, 25, "all", "groceries");

			expect(result.total).toBe(2);
			expect(result.sumOut).toBe(75);
		});

		it("excludes transactions on accounts not shared with the group", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			const shared = await seedAccount(user.id);
			const unshared = await seedAccount(user.id, { last_four: "0002" });
			await seedAccountMember(shared.id, user.id, "owner");
			await seedAccountMember(unshared.id, user.id, "owner");
			await seedAccountGroupVisibility(shared.id, group.id);

			await seedTx(user.id, shared.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, unshared.id, { amount: -999, category: "groceries" });

			const result = await getGroupTransactionsPaged(group.id, 1, 25, "all");

			expect(result.total).toBe(1);
			expect(result.sumOut).toBe(50); // the unshared 999 is excluded
		});
	});

	describe("getGroupTransactionCategories", () => {
		it("returns distinct categories only from shared accounts", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			const shared = await seedAccount(user.id);
			const unshared = await seedAccount(user.id, { last_four: "0003" });
			await seedAccountMember(shared.id, user.id, "owner");
			await seedAccountMember(unshared.id, user.id, "owner");
			await seedAccountGroupVisibility(shared.id, group.id);

			await seedTx(user.id, shared.id, { amount: -50, category: "groceries" });
			await seedTx(user.id, unshared.id, { amount: -10, category: "travel" });

			const categories = await getGroupTransactionCategories(group.id);

			expect(categories).toEqual(["groceries"]);
		});
	});

	// ============================================
	// getMemberTransactionsPaged — per-member scoping
	// ============================================

	describe("getMemberTransactionsPaged", () => {
		it("returns only the member's transactions on group-shared accounts, filtered by category", async () => {
			const creator = await seedUser();
			const member = await seedUser({ email: "member@example.com", username: "member" });
			const group = await seedGroup(creator.id);

			const creatorAccount = await seedAccount(creator.id);
			const memberAccount = await seedAccount(member.id, { last_four: "7777" });
			await seedAccountMember(creatorAccount.id, creator.id, "owner");
			await seedAccountMember(memberAccount.id, member.id, "owner");
			await seedAccountGroupVisibility(creatorAccount.id, group.id);
			await seedAccountGroupVisibility(memberAccount.id, group.id);

			await seedTx(creator.id, creatorAccount.id, { amount: -50, category: "groceries" });
			await seedTx(member.id, memberAccount.id, { amount: -40, category: "groceries" });
			await seedTx(member.id, memberAccount.id, { amount: -15, category: "dining" });

			const all = await getMemberTransactionsPaged(group.id, member.id, 1, 25, "all");
			expect(all.total).toBe(2); // only the member's two, not the creator's

			const groceries = await getMemberTransactionsPaged(
				group.id,
				member.id,
				1,
				25,
				"all",
				"groceries"
			);
			expect(groceries.total).toBe(1);
			expect(groceries.sumOut).toBe(40);
		});
	});

	describe("getMemberTransactionCategories", () => {
		it("returns distinct categories for one member's shared transactions", async () => {
			const creator = await seedUser();
			const member = await seedUser({ email: "member2@example.com", username: "member2" });
			const group = await seedGroup(creator.id);
			const memberAccount = await seedAccount(member.id, { last_four: "8888" });
			await seedAccountMember(memberAccount.id, member.id, "owner");
			await seedAccountGroupVisibility(memberAccount.id, group.id);

			await seedTx(member.id, memberAccount.id, { amount: -40, category: "dining" });
			await seedTx(member.id, memberAccount.id, { amount: -15, category: null });

			const categories = await getMemberTransactionCategories(group.id, member.id);

			expect([...categories].sort()).toEqual(["Other", "dining"]);
		});
	});

	// ============================================
	// Timeframe (range) filter
	// ============================================

	describe("range filter", () => {
		it("narrows the result set to the selected timeframe", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			await seedTx(user.id, account.id, { amount: -10, transaction_date: thisMonthISO() });
			await seedTx(user.id, account.id, { amount: -20, transaction_date: monthsAgoISO(1) });
			await seedTx(user.id, account.id, { amount: -30, transaction_date: monthsAgoISO(4) });

			const month = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "month");
			expect(month.total).toBe(1); // only the current-month row

			const threeMonths = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "3m");
			expect(threeMonths.total).toBe(2); // current + last month; the 4-mo-ago row drops

			const all = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "all");
			expect(all.total).toBe(3);
		});

		it("scopes the summary aggregates to the timeframe too", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			await seedTx(user.id, account.id, { amount: 100, transaction_date: thisMonthISO() });
			await seedTx(user.id, account.id, { amount: -40, transaction_date: thisMonthISO() });
			await seedTx(user.id, account.id, { amount: -999, transaction_date: monthsAgoISO(4) });

			const month = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "month");

			expect(month.sumIn).toBe(100);
			expect(month.sumOut).toBe(40); // the older −999 is outside the window
		});
	});

	// ============================================
	// Per-month breakdown (section headers)
	// ============================================

	describe("monthly breakdown", () => {
		it("returns per-month buckets newest-first with correct in/out/net/count", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			const thisMonth = thisMonthISO();
			const lastMonth = monthsAgoISO(1);

			await seedTx(user.id, account.id, { amount: 100, transaction_date: thisMonth });
			await seedTx(user.id, account.id, { amount: 50, transaction_date: thisMonth });
			await seedTx(user.id, account.id, { amount: -40, transaction_date: thisMonth });
			await seedTx(user.id, account.id, { amount: -25, transaction_date: lastMonth });

			const result = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "all");

			expect(result.monthly).toHaveLength(2);
			// Newest month first, matching the DESC row ordering.
			const [current, prior] = result.monthly;
			expect(current.monthKey).toBe(monthKeyOf(thisMonth));
			expect(current.sumIn).toBe(150);
			expect(current.sumOut).toBe(40);
			expect(current.net).toBe(110);
			expect(current.count).toBe(3);

			expect(prior.monthKey).toBe(monthKeyOf(lastMonth));
			expect(prior.sumIn).toBe(0);
			expect(prior.sumOut).toBe(25);
			expect(prior.net).toBe(-25);
			expect(prior.count).toBe(1);
		});

		it("computes month buckets over the whole filtered set, not just the page", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			const thisMonth = thisMonthISO();
			for (let i = 0; i < 5; i++) {
				await seedTx(user.id, account.id, { amount: -10, transaction_date: thisMonth });
			}

			// Page size 2 → the page holds 2 rows, but the month bucket covers all 5.
			const result = await getMyTransactionsPaged(user.id, 1, 2, "all", undefined, "month");

			expect(result.transactions).toHaveLength(2);
			expect(result.monthly).toHaveLength(1);
			expect(result.monthly[0].count).toBe(5);
			expect(result.monthly[0].sumOut).toBe(50);
		});

		it("scopes the group breakdown to shared accounts", async () => {
			const user = await seedUser();
			const group = await seedGroup(user.id);
			const shared = await seedAccount(user.id);
			const unshared = await seedAccount(user.id, { last_four: "0009" });
			await seedAccountMember(shared.id, user.id, "owner");
			await seedAccountMember(unshared.id, user.id, "owner");
			await seedAccountGroupVisibility(shared.id, group.id);

			const thisMonth = thisMonthISO();
			await seedTx(user.id, shared.id, { amount: -30, transaction_date: thisMonth });
			await seedTx(user.id, unshared.id, { amount: -500, transaction_date: thisMonth });

			const result = await getGroupTransactionsPaged(group.id, 1, 25, "all", undefined, "month");

			expect(result.monthly).toHaveLength(1);
			expect(result.monthly[0].sumOut).toBe(30); // unshared 500 excluded
			expect(result.monthly[0].count).toBe(1);
		});
	});

	// ============================================
	// Free-text search (merchant_name / description)
	// ============================================

	describe("search filter", () => {
		it("matches merchant_name or description, case-insensitively", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			await seedTx(user.id, account.id, { amount: -5, merchant_name: "Starbucks", description: "coffee" });
			await seedTx(user.id, account.id, { amount: -40, merchant_name: "Amazon", description: "books order" });
			await seedTx(user.id, account.id, { amount: -60, merchant_name: "Whole Foods", description: "weekly groceries" });

			// Merchant match.
			const byMerchant = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "all", "amazon");
			expect(byMerchant.total).toBe(1);
			expect(byMerchant.transactions[0].merchant_name).toBe("Amazon");

			// Description match, different case.
			const byDescription = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "all", "GROCERIES");
			expect(byDescription.total).toBe(1);
			expect(byDescription.transactions[0].merchant_name).toBe("Whole Foods");

			// No match.
			const none = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "all", "netflix");
			expect(none.total).toBe(0);
		});

		it("scopes the summary and monthly breakdown to matches", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			const thisMonth = thisMonthISO();
			await seedTx(user.id, account.id, { amount: -40, merchant_name: "Amazon", transaction_date: thisMonth });
			await seedTx(user.id, account.id, { amount: -60, merchant_name: "Amazon", transaction_date: thisMonth });
			await seedTx(user.id, account.id, { amount: -5, merchant_name: "Starbucks", transaction_date: thisMonth });

			const result = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "all", "amazon");

			expect(result.total).toBe(2);
			expect(result.sumOut).toBe(100); // only the two Amazon rows
			expect(result.countOut).toBe(2);
			expect(result.monthly).toHaveLength(1);
			expect(result.monthly[0].sumOut).toBe(100);
			expect(result.monthly[0].count).toBe(2);
		});

		it("composes with the category and timeframe filters", async () => {
			const user = await seedUser();
			const account = await seedAccount(user.id);
			await seedAccountMember(account.id, user.id, "owner");

			const thisMonth = thisMonthISO();
			await seedTx(user.id, account.id, { amount: -40, merchant_name: "Amazon", category: "shopping", transaction_date: thisMonth });
			await seedTx(user.id, account.id, { amount: -30, merchant_name: "Amazon", category: "dining", transaction_date: thisMonth });
			await seedTx(user.id, account.id, { amount: -50, merchant_name: "Amazon", category: "shopping", transaction_date: monthsAgoISO(4) });

			// search + category narrows to the one matching both.
			const withCategory = await getMyTransactionsPaged(user.id, 1, 25, "all", "dining", "all", "amazon");
			expect(withCategory.total).toBe(1);
			expect(withCategory.sumOut).toBe(30);

			// search + range drops the 4-month-old Amazon row.
			const withRange = await getMyTransactionsPaged(user.id, 1, 25, "all", undefined, "month", "amazon");
			expect(withRange.total).toBe(2);
		});
	});
});
