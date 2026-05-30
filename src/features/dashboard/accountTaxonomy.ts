// Account type/subtype options for the manual "Add account" form. Each subtype
// here must be a member of the backend's ACCOUNT_SUBTYPES list for its type
// (node/src/services/plaid/subtypeMap.ts) — createAccountSchema rejects any
// subtype that isn't. This is a curated subset of the most common subtypes, not
// Plaid's full taxonomy, since manual entry only needs the everyday cases.

export type ManualAccountType = "depository" | "credit" | "loan" | "investment";

export const ACCOUNT_TYPE_OPTIONS: { value: ManualAccountType; label: string }[] = [
	{ value: "depository", label: "Cash & banking" },
	{ value: "credit", label: "Credit card" },
	{ value: "loan", label: "Loan" },
	{ value: "investment", label: "Investment" },
];

export const SUBTYPE_OPTIONS: Record<ManualAccountType, { value: string; label: string }[]> = {
	depository: [
		{ value: "checking", label: "Checking" },
		{ value: "savings", label: "Savings" },
		{ value: "money market", label: "Money market" },
		{ value: "cd", label: "CD" },
		{ value: "cash management", label: "Cash management" },
		{ value: "hsa", label: "HSA" },
		{ value: "prepaid", label: "Prepaid" },
	],
	credit: [{ value: "credit card", label: "Credit card" }],
	loan: [
		{ value: "auto", label: "Auto" },
		{ value: "mortgage", label: "Mortgage" },
		{ value: "home equity", label: "Home equity" },
		{ value: "student", label: "Student" },
		{ value: "line of credit", label: "Line of credit" },
		{ value: "loan", label: "Other loan" },
	],
	investment: [
		{ value: "brokerage", label: "Brokerage" },
		{ value: "401k", label: "401(k)" },
		{ value: "roth", label: "Roth IRA" },
		{ value: "ira", label: "Traditional IRA" },
		{ value: "529", label: "529" },
		{ value: "retirement", label: "Retirement" },
		{ value: "crypto exchange", label: "Crypto" },
	],
};
