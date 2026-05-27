//Plaid configuration

import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const isProduction = process.env.PLAID_ENV === "production";

if (!process.env.PLAID_CLIENT_ID) {
	throw new Error("PLAID_CLIENT_ID environment variable is not defined");
}
if (isProduction) {
	if (!process.env.PLAID_PRODUCTION_SECRET) {
		throw new Error("PLAID_PRODUCTION_SECRET environment variable is not defined");
	}
} else {
	if (!process.env.PLAID_SANDBOX_SECRET) {
		throw new Error("PLAID_SANDBOX_SECRET environment variable is not defined");
	}
}

const configuration = new Configuration({
	basePath: isProduction ? PlaidEnvironments.production : PlaidEnvironments.sandbox,
	baseOptions: {
		headers: {
			"PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
			"PLAID-SECRET": isProduction
				? process.env.PLAID_PRODUCTION_SECRET!
				: process.env.PLAID_SANDBOX_SECRET!,
		},
	},
});

export const plaidClient = new PlaidApi(configuration);
