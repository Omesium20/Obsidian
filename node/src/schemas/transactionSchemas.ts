import { z } from "zod";

export const createTransactionSchema = z.object({
	transaction_date: z.iso.date(),
	amount: z.number().nullish(),
	description: z.string().nullish(),
	category: z.string().max(50).nullish(),
	merchant_name: z.string().max(255).nullish(),
	plaid_id: z.string().max(255).nullish(),
	entry_method: z.string().optional(),
	// When present, the new transaction is linked to this account via
	// account_transactions so it shows up on the dashboard (which joins through
	// that table). Required for manually-entered transactions.
	account_id: z.number().int().positive().optional(),
});

export const deleteTransactionSchema = z.object({
	id: z.number().int().positive(),
});
