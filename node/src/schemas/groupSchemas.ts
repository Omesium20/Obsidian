import { z } from "zod";

export const deleteGroupSchema = z.object({
	id: z.number().int().positive(),
});

export const leaveGroupSchema = z.object({
	id: z.number().int().positive(),
});

export const kickMemberSchema = z.object({
	user_id: z.number().int().positive(),
});

export const renameGroupSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Household name is required")
		.max(100, "Household name must be 100 characters or fewer"),
});
