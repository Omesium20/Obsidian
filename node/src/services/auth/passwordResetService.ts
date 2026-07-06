import crypto from "crypto";
import { hashToken, hashPassword } from "../../utils/hashing.js";
import { findByEmail } from "../../repository/userRepository.js";
import {
	storeResetToken,
	findValidResetToken,
	resetPasswordAndMarkUsed,
	purgeExpiredResetTokens,
} from "../../repository/passwordResetRepository.js";
import { AuthenticationError } from "../../errors/index.js";
import {
	recordAuthEvent,
	AuthRequestContext,
} from "../audit/authEventService.js";

const RESET_TOKEN_EXPIRES_HOURS = 1;

export const requestPasswordReset = async (
	email: string,
	context: AuthRequestContext = {}
): Promise<{ token: string; userId: number } | null> => {
	const user = await findByEmail(email);
	if (!user) {
		// The HTTP response stays non-leaking (always 200); user_exists is
		// internal signal for the audit trail only.
		await recordAuthEvent("PASSWORD_RESET_REQUESTED", {
			detail: { email, ip: context.ip, user_exists: false },
		});
		return null;
	}

	const rawToken = crypto.randomBytes(32).toString("hex");
	const tokenHash = hashToken(rawToken);

	const expiresAt = new Date();
	expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRES_HOURS);

	await storeResetToken(user.id, tokenHash, expiresAt);

	await recordAuthEvent("PASSWORD_RESET_REQUESTED", {
		userId: user.id,
		detail: { email, ip: context.ip, user_exists: true },
	});

	return { token: rawToken, userId: user.id };
};

export const resetPassword = async (
	token: string,
	newPassword: string,
	context: AuthRequestContext = {}
): Promise<void> => {
	const tokenHash = hashToken(token);
	const stored = await findValidResetToken(tokenHash);

	if (!stored) {
		// Token-guessing signal: bursts of these from one IP are an attack.
		await recordAuthEvent("PASSWORD_RESET_FAILED", {
			detail: { ip: context.ip, reason: "invalid_or_expired_token" },
		});
		throw new AuthenticationError("Invalid or expired reset token");
	}

	const hashedPassword = await hashPassword(newPassword);
	await resetPasswordAndMarkUsed(stored.user_id, hashedPassword, stored.id);

	await recordAuthEvent("PASSWORD_RESET_COMPLETED", {
		userId: stored.user_id,
		detail: { ip: context.ip },
	});
};

export { purgeExpiredResetTokens };
