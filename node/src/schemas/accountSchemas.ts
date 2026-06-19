import { z } from "zod";
import { ACCOUNT_TYPES, ACCOUNT_SUBTYPES } from "../services/plaid/subtypeMap.js";

export const createAccountSchema = z
	.object({
		account_name: z.string().min(1).max(255),
		type: z.enum(ACCOUNT_TYPES).nullish(),
		subtype: z.string().min(1).max(50).nullish(),
		institution_name: z.string().max(255).nullish(),
		last_four: z.string().length(4).nullish(),
		plaid_account_id: z.string().max(255).nullish(),
		plaid_item_id: z.string().max(255).nullish(),
		balance_current: z.number().nullish(),
		balance_available: z.number().nullish(),
		currency_code: z.string().max(3).nullish(),
		is_active: z.boolean().nullish(),
	})
	.superRefine((data, ctx) => {
		// A subtype only makes sense in the context of a type, and must be one of
		// the subtypes Plaid defines for that type.
		if (data.subtype && !data.type) {
			ctx.addIssue({
				code: "custom",
				path: ["type"],
				message: "type is required when subtype is provided",
			});
			return;
		}
		if (
			data.type &&
			data.subtype &&
			!ACCOUNT_SUBTYPES[data.type].includes(data.subtype)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["subtype"],
				message: `Invalid subtype "${data.subtype}" for type "${data.type}"`,
			});
		}
	});

// Editable fields on a manually-entered account. All optional — the route
// applies only what's sent (the repository COALESCEs the rest). Same type/subtype
// validity rule as create.
export const updateAccountSchema = z
	.object({
		account_name: z.string().min(1).max(255).optional(),
		type: z.enum(ACCOUNT_TYPES).optional(),
		subtype: z.string().min(1).max(50).nullish(),
		institution_name: z.string().max(255).nullish(),
		last_four: z.string().length(4).nullish(),
		balance_current: z.number().nullish(),
	})
	.superRefine((data, ctx) => {
		if (
			data.type &&
			data.subtype &&
			!ACCOUNT_SUBTYPES[data.type].includes(data.subtype)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["subtype"],
				message: `Invalid subtype "${data.subtype}" for type "${data.type}"`,
			});
		}
	});

export const deleteAccountSchema = z.object({
	account_id: z.number().int().positive(),
});

// Optional body on DELETE /accounts/:id — only needed when an account has more
// than one joint co-owner and the deleter must pick who inherits it.
export const deleteAccountTransferSchema = z.object({
	new_owner_user_id: z.number().int().positive().optional(),
});

// PUT /accounts/:id/visibility — household visibility toggle.
export const accountVisibilitySchema = z.object({
	visibility: z.enum(["private", "group"]),
});

// PUT /accounts/:id/joint — user-declared joint flag.
export const accountJointSchema = z.object({
	value: z.boolean(),
});

// POST /accounts/:id/members — link a household member as a joint co-owner.
export const addCoOwnerSchema = z.object({
	user_id: z.number().int().positive(),
});

// URL params for /accounts/:id/members/:userId
export const memberParamSchema = z.object({
	id: z.coerce.number().int().positive(),
	userId: z.coerce.number().int().positive(),
});

// Query params for an account's paginated transaction list.
// Mirrors dashboardTxQuerySchema minus the `view` field — a single account is
// already the scope, so only page + amount filter are needed.
export const accountTxQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	filter: z.enum(["all", "income", "spend"]).default("all"),
});
