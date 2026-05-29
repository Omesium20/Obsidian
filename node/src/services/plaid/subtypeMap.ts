// Canonical Plaid account taxonomy + sanitizer. This is the single source of
// truth for valid account types/subtypes, shared by the Plaid ingestion path
// (sanitizePlaidAccountType, called from itemService) and the manual-entry path
// (accountSchemas.ts). accounts.type / accounts.subtype store these verbatim.
//
// type is one of Plaid's 4 top-level types. subtype is stored as-is from Plaid;
// the lists below mirror Plaid's documented subtypes but are NOT enforced at the
// DB level, so a newly-added Plaid subtype never breaks an insert.

export const ACCOUNT_TYPES = [
	"depository",
	"credit",
	"loan",
	"investment",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_SUBTYPES: Record<AccountType, readonly string[]> = {
	depository: [
		"cash",
		"cash management",
		"cd",
		"checking",
		"ebt",
		"hsa",
		"limited purpose checking",
		"money market",
		"paypal",
		"prepaid",
		"savings",
	],
	credit: ["credit card", "paypal"],
	loan: [
		"auto",
		"business",
		"commercial",
		"construction",
		"consumer",
		"home equity",
		"line of credit",
		"loan",
		"mortgage",
		"other",
		"overdraft",
		"student",
	],
	investment: [
		"401a",
		"401k",
		"403B",
		"457b",
		"529",
		"brokerage",
		"cash isa",
		"crypto exchange",
		"education savings account",
		"fhsa",
		"fixed annuity",
		"gic",
		"health reimbursement arrangement",
		"ira",
		"isa",
		"keogh",
		"lif",
		"life insurance",
		"lira",
		"lrif",
		"lrsp",
		"mutual fund",
		"non-custodial wallet",
		"non-taxable brokerage account",
		"other",
		"other annuity",
		"other insurance",
		"pension",
		"prif",
		"profit sharing plan",
		"qshr",
		"rdsp",
		"resp",
		"retirement",
		"rlif",
		"roth",
		"roth 401k",
		"roth 403B",
		"roth 457b",
		"roth pension",
		"roth profit sharing plan",
		"roth thrift savings plan",
		"rrif",
		"rrsp",
		"sarsep",
		"sep ira",
		"simple ira",
		"sipp",
		"stock plan",
		"student",
		"thrift savings plan",
		"tfsa",
		"trust",
		"ugma",
		"utma",
		"variable annuity",
	],
};

function isAccountType(value: string): value is AccountType {
	return (ACCOUNT_TYPES as readonly string[]).includes(value);
}

// Normalize + validate the (type, subtype) Plaid returns. Returns null when the
// top-level type is unknown/unsupported (e.g. Plaid "other") so the caller can
// warn and skip the account. The subtype is trimmed and stored verbatim — any
// value Plaid sends is preserved, even if it isn't in ACCOUNT_SUBTYPES.
export function sanitizePlaidAccountType(
	type: string | null | undefined,
	subtype: string | null | undefined
): { type: AccountType; subtype: string | null } | null {
	const t = type?.trim().toLowerCase();
	if (!t || !isAccountType(t)) return null;

	const s = subtype?.trim();
	return { type: t, subtype: s ? s : null };
}
