import { signAccessToken, signRefreshToken, verifyRefreshToken, AccessTokenPayload } from "../../utils/jwt.js";
import { hashToken } from "../../utils/hashing.js";
import {
	storeRefreshToken,
	findRefreshToken,
	revokeRefreshToken,
	revokeAllUserRefreshTokens,
} from "../../repository/refreshTokenRepository.js";
import { findActiveMembership } from "../../repository/groupRepository.js";
import { AuthenticationError } from "../../errors/index.js";

const REFRESH_TOKEN_EXPIRES_DAYS = 7;
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;

export const issueRefreshToken = async (userId: number): Promise<string> => {
	const refreshToken = signRefreshToken({ userId });
	const tokenHash = hashToken(refreshToken);
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);
	await storeRefreshToken(userId, tokenHash, expiresAt);
	return refreshToken;
};

export const refreshTokens = async (
	incomingToken: string
): Promise<{ accessToken: string; refreshToken: string; payload: AccessTokenPayload }> => {
	let payload: { userId: number };
	try {
		payload = verifyRefreshToken(incomingToken);
	} catch {
		throw new AuthenticationError("Invalid or expired refresh token");
	}

	const tokenHash = hashToken(incomingToken);
	const stored = await findRefreshToken(tokenHash);
	if (!stored) {
		throw new AuthenticationError("Refresh token not recognised or already revoked");
	}

	const lastActivity = new Date(stored.created_at!).getTime();
	if (Date.now() - lastActivity > INACTIVITY_LIMIT_MS) {
		await revokeAllUserRefreshTokens(payload.userId);
		throw new AuthenticationError("Session expired due to inactivity");
	}

	// Rotate: revoke old, issue new
	await revokeRefreshToken(tokenHash);

	const membership = await findActiveMembership(payload.userId);

	const accessPayload: AccessTokenPayload = {
		userId: payload.userId,
		groupId: membership?.group_id ?? null,
		role: membership?.role ?? null,
	};

	const accessToken = signAccessToken(accessPayload);
	const newRefreshToken = await issueRefreshToken(payload.userId);

	return { accessToken, refreshToken: newRefreshToken, payload: accessPayload };
};
