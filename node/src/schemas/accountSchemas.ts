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

export const deleteAccountSchema = z.object({
	account_id: z.number().int().positive(),
});
