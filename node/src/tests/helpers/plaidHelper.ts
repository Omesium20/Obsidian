import { Products } from "plaid";
import { plaidClient } from "../../config/plaid.js";
import { exchangePublicToken, ExchangeResult } from "../../services/plaid/itemService.js";
import { findByUserId, getDecryptedAccessToken } from "../../repository/plaidItemRepository.js";
import { syncTransactions } from "../../services/plaid/transactionsSyncService.js";

// Prevent accidental calls outside the sandbox environment.
// Tests that use this helper make real Plaid API calls — they require genuine
// sandbox credentials in .env.test and PLAID_ENV=sandbox to be set.
function assertSandbox(): void {
	if (process.env.PLAID_ENV !== "sandbox") {
		throw new Error(
			`seedPlaidItem can only run against Plaid sandbox ` +
				`(PLAID_ENV="${process.env.PLAID_ENV ?? "unset"}"). ` +
				`Set PLAID_ENV=sandbox in .env.test.`
		);
	}
}

export interface SandboxItemOptions {
	institutionId?: string;
	overrideUsername?: string;
	overridePassword?: string;
}

/**
 * Creates a Plaid sandbox item and runs it through the full exchangePublicToken
 * service — the same path as onboarding. The result contains the linked accounts
 * and the initial 30-day transaction sync is already applied to the test DB.
 *
 * Plaid sandbox processes transactions asynchronously, so the initial sync in
 * exchangePublicToken may return 0. This helper retries with backoff (up to 3×
 * at 4-second intervals) until transactions appear.
 *
 * Requires PLAID_ENV=sandbox in .env.test and real sandbox credentials.
 */
export async function seedPlaidItem(
	userId: number,
	groupId: number,
	options: SandboxItemOptions = {}
): Promise<ExchangeResult> {
	assertSandbox();

	const {
		institutionId = "ins_109508",
		overrideUsername = "user_good",
		overridePassword = "pass_good",
	} = options;

	const { data } = await plaidClient.sandboxPublicTokenCreate({
		institution_id: institutionId,
		initial_products: [Products.Transactions],
		options: {
			override_username: overrideUsername,
			override_password: overridePassword,
		},
	});

	const result = await exchangePublicToken(userId, groupId, data.public_token);

	// Sandbox transactions are loaded asynchronously; retry sync if the initial
	// pass returned 0 so tests can assert on real transaction data.
	if (result.transactionCount === 0) {
		const items = await findByUserId(userId);
		const item = items.at(-1);

		if (item) {
			const accessToken = getDecryptedAccessToken(item);
			const RETRY_DELAY_MS = 4000;
			const MAX_RETRIES = 3;

			for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
				try {
					const retry = await syncTransactions(item.id, accessToken, userId);
					if (retry.added > 0) {
						result.transactionCount = retry.added;
						break;
					}
				} catch {
					// continue to next attempt
				}
			}
		}
	}

	return result;
}
