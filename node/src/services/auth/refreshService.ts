import { signAccessToken, signRefreshToken, verifyRefreshToken, AccessTokenPayload } from "../../utils/jwt.js";
import { hashToken } from "../../utils/hashing.js";
import {
	storeRefreshToken,
	findRefreshToken,
	touchRefreshToken,
	revokeAllUserRefreshTokens,
} from "../../repository/refreshTokenRepository.js";
import { findActiveMembership } from "../../repository/groupRepository.js";
import { AuthenticationError } from "../../errors/index.js";
import {
	recordAuthEvent,
	AuthRequestContext,
} from "../audit/authEventService.js";

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

// Best-effort activity bump for a still-valid access token. Called on every
// authenticated request so the inactivity timer tracks real request activity,
// not just silent-refresh events. Slides last_used_at and the 7-day expiry the
// same way a refresh does. Never throws — a failed activity write must not
// block an otherwise-valid request (it would turn into a spurious 500).
export const recordRefreshTokenActivity = async (
	incomingToken: string
): Promise<void> => {
	try {
		const tokenHash = hashToken(incomingToken);
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);
		await touchRefreshToken(tokenHash, expiresAt);
	} catch (err) {
		console.error("Failed to record refresh token activity:", err);
	}
};

export const refreshTokens = async (
	incomingToken: string,
	context: AuthRequestContext = {}
): Promise<{ accessToken: string; refreshToken: string; payload: AccessTokenPayload }> => {
	let payload: { userId: number };
	try {
		payload = verifyRefreshToken(incomingToken);
	} catch {
		await recordAuthEvent("REFRESH_FAILED", {
			detail: { ip: context.ip, reason: "invalid_or_expired_jwt" },
		});
		throw new AuthenticationError("Invalid or expired refresh token");
	}

	const tokenHash = hashToken(incomingToken);
	const stored = await findRefreshToken(tokenHash);
	if (!stored) {
		// A validly-signed token that isn't in the store: revoked, rotated away,
		// or replayed after logout — worth attributing to the user it names.
		await recordAuthEvent("REFRESH_FAILED", {
			userId: payload.userId,
			detail: { ip: context.ip, reason: "unrecognised_or_revoked" },
		});
		throw new AuthenticationError("Refresh token not recognised or already revoked");
	}

	// Inactivity is measured from the last time this token was used (or created,
	// for tokens issued before last_used_at existed), not from rotation — we no
	// longer rotate on every refresh.
	const lastActivity = new Date(stored.last_used_at ?? stored.created_at!).getTime();
	if (Date.now() - lastActivity > INACTIVITY_LIMIT_MS) {
		await revokeAllUserRefreshTokens(payload.userId);
		await recordAuthEvent("SESSION_REVOKED", {
			userId: payload.userId,
			actionSource: "system",
			detail: { ip: context.ip, reason: "inactivity" },
		});
		throw new AuthenticationError("Session expired due to inactivity");
	}

	// Do NOT rotate the refresh token here. Rotating on every silent refresh
	// created a race: two concurrent requests carrying the same (expired-access)
	// cookie would both try to refresh, the first revoking the token out from
	// under the second, which then 401s and forces a re-login. Instead we keep
	// the refresh token, bump its activity timestamp, and slide its expiry so an
	// actively-used session survives, while the 30-min inactivity rule still
	// applies. The refresh token is still rotated at login/logout/password-change.
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);
	await touchRefreshToken(tokenHash, expiresAt);

	const membership = await findActiveMembership(payload.userId);

	const accessPayload: AccessTokenPayload = {
		userId: payload.userId,
		groupId: membership?.group_id ?? null,
		role: membership?.role ?? null,
	};

	const accessToken = signAccessToken(accessPayload);

	// Return the same refresh token; the middleware re-sets the cookie, refreshing
	// its 7-day max-age to match the slid DB expiry (sliding session).
	return { accessToken, refreshToken: incomingToken, payload: accessPayload };
};
