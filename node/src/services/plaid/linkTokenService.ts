import { CountryCode, Products } from "plaid";
import { plaidClient } from "../../config/plaid.js";
import { ExternalServiceError } from "../../errors/index.js";

export const createLinkToken = async (
	userId: number
): Promise<{ link_token: string; expiration: string }> => {
	try {
		const res = await plaidClient.linkTokenCreate({
			user: { client_user_id: String(userId) },
			client_name: "Obsidian Financial",
			// Transactions drives the ledger; Investments lets brokerage/retirement
			// accounts (e.g. Schwab) through Link so their total value lands in
			// accounts.balance_current. We only read the account-level balance, not
			// holdings/investment transactions (separate products).
			products: [Products.Transactions, Products.Investments],
			country_codes: [CountryCode.Us],
			language: "en",
			// Plaid defaults to 90 days of history on a new Item; request 180 so
			// the initial sync pulls a full six months (max 730).
			transactions: { days_requested: 180 },
		});
		return {
			link_token: res.data.link_token,
			expiration: res.data.expiration,
		};
	} catch (e) {
		throw new ExternalServiceError("Plaid", "Failed to create link token", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
