import jwt from "jsonwebtoken";

if (!process.env.JWT_ACCESS_SECRET) {
	throw new Error("JWT_ACCESS_SECRET environment variable is not defined");
}
if (!process.env.JWT_REFRESH_SECRET) {
	throw new Error("JWT_REFRESH_SECRET environment variable is not defined");
}

const JWT_ACCESS_SECRET: string = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET: string = process.env.JWT_REFRESH_SECRET;

export interface AccessTokenPayload {
	userId: number;
	groupId: number | null;
	role: string | null;
}

export function signAccessToken(payload: AccessTokenPayload): string {
	return jwt.sign(payload, JWT_ACCESS_SECRET, {
		expiresIn: "15m",
		algorithm: "HS256",
	});
}

// No `expiresIn` here deliberately: refresh-token lifetime is governed by the
// refresh_tokens row (expires_at/revoked_at, slid forward on every use by
// touchRefreshToken — see refreshService.ts). A baked-in JWT `exp` would cap
// the session at a fixed 7 days from login regardless of activity, defeating
// that sliding-expiry design.
export function signRefreshToken(payload: { userId: number }): string {
	return jwt.sign(payload, JWT_REFRESH_SECRET, {
		algorithm: "HS256",
	});
}

export function verifyAccessToken(token: string): AccessTokenPayload {
	return jwt.verify(token, JWT_ACCESS_SECRET, {
		algorithms: ["HS256"],
	}) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { userId: number } {
	return jwt.verify(token, JWT_REFRESH_SECRET, {
		algorithms: ["HS256"],
	}) as { userId: number };
}
