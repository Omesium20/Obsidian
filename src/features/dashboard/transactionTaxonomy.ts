// Category options for the manual "Add transaction" form. The stored values are
// Plaid's personal_finance_category.primary values verbatim, so manually-entered
// transactions bucket into the same categories as Plaid-synced ones on the
// dashboard charts (the sync path stores tx.personal_finance_category.primary —
// see transactionsSyncService.ts). The category column is free-form VARCHAR(50),
// so these are not DB-enforced; they just keep manual + synced data consistent.

export type TransactionCategory = { value: string; label: string };

// Spending-oriented categories first (the common case for manual entry — cash
// purchases Plaid can't see), with income/transfers grouped at the end.
export const TRANSACTION_CATEGORIES: TransactionCategory[] = [
	{ value: "FOOD_AND_DRINK", label: "Food & drink" },
	{ value: "GENERAL_MERCHANDISE", label: "Shopping" },
	{ value: "TRANSPORTATION", label: "Transportation" },
	{ value: "TRAVEL", label: "Travel" },
	{ value: "RENT_AND_UTILITIES", label: "Rent & utilities" },
	{ value: "ENTERTAINMENT", label: "Entertainment" },
	{ value: "PERSONAL_CARE", label: "Personal care" },
	{ value: "MEDICAL", label: "Medical" },
	{ value: "HOME_IMPROVEMENT", label: "Home improvement" },
	{ value: "GENERAL_SERVICES", label: "Services" },
	{ value: "GOVERNMENT_AND_NON_PROFIT", label: "Government & non-profit" },
	{ value: "LOAN_PAYMENTS", label: "Loan payments" },
	{ value: "BANK_FEES", label: "Bank fees" },
	{ value: "INCOME", label: "Income" },
	{ value: "TRANSFER_IN", label: "Transfer in" },
	{ value: "TRANSFER_OUT", label: "Transfer out" },
];
