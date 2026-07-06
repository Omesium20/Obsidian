import { verifyPassword } from "../../utils/hashing.js";
import { findByEmail } from "../../repository/userRepository.js";
import { signAccessToken } from "../../utils/jwt.js";
import { AuthenticationError } from "../../errors/index.js";
import { issueRefreshToken } from "./refreshService.js";
import { revokeAllUserRefreshTokens } from "../../repository/refreshTokenRepository.js";
import { findActiveMembership } from "../../repository/groupRepository.js";
import {
	recordAuthEvent,
	AuthRequestContext,
} from "../audit/authEventService.js";

interface loginCredentials {
	email: string;
	password: string;
}

export const loginUser = async (
	payload: loginCredentials,
	context: AuthRequestContext = {}
) => {
	const userData = await findByEmail(payload.email);
	if (!userData) {
		await recordAuthEvent("LOGIN_FAILED", {
			detail: { email: payload.email, ip: context.ip, reason: "unknown_email" },
		});
		throw new AuthenticationError("Invalid credentials");
	}

	const validPassword = await verifyPassword(userData.password_hash, payload.password);
	if (!validPassword) {
		await recordAuthEvent("LOGIN_FAILED", {
			userId: userData.id,
			detail: { email: payload.email, ip: context.ip, reason: "bad_password" },
		});
		throw new AuthenticationError("Invalid credentials");
	}

	const membership = await findActiveMembership(userData.id);

	const accessToken = signAccessToken({
		userId: userData.id,
		groupId: membership?.group_id ?? null,
		role: membership?.role ?? null,
	});

	await revokeAllUserRefreshTokens(userData.id);
	const refreshToken = await issueRefreshToken(userData.id);

	await recordAuthEvent("LOGIN_SUCCESS", {
		userId: userData.id,
		detail: { ip: context.ip },
	});

	return { accessToken, refreshToken };
};
