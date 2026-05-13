import { z } from "zod";

export const passwordSchema = z
	.string()
	.min(16, "Password must be at least 16 characters")
	.max(64, "Password must be at most 64 characters")
	.regex(/[a-z]/, "Password must contain at least one lowercase letter")
	.regex(/[A-Z]/, "Password must contain at least one uppercase letter")
	.regex(/[0-9]/, "Password must contain at least one number")
	.regex(
		/[^a-zA-Z0-9]/,
		"Password must contain at least one special character"
	);

export const loginSchema = z.object({
	email: z.email(),
	password: z.string().min(1),
});

export const registerSchema = z.object({
	email: z.email(),
	password_hash: passwordSchema,
	username: z.string().min(1).max(30),
	first_name: z.string().min(1).max(50),
	last_name: z.string().min(1).max(50),
});

export const requestPasswordResetSchema = z.object({
	email: z.email(),
});

export const resetPasswordSchema = z.object({
	token: z.string().min(1),
	new_password: passwordSchema,
});
