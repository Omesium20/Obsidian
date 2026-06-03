import { z } from "zod";

export const deleteUserSchema = z.object({
	id: z.number().int().positive(),
});

// Update the caller's own display name. last_name may be empty (single-word
// names); first_name must have content. Both are capped at the column width.
export const updateProfileSchema = z.object({
	first_name: z.string().trim().min(1, "Name is required").max(50),
	last_name: z.string().trim().max(50),
});

// Admin user creation — same shape as registration input
export const createUserSchema = z.object({
	email: z.email().max(255),
	password_hash: z.string().min(8).max(255),
	username: z.string().min(1).max(30),
	first_name: z.string().min(1).max(50),
	last_name: z.string().min(1).max(50),
});
