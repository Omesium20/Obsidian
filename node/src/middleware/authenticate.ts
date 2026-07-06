import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken, AccessTokenPayload } from "../utils/jwt.js";
import { refreshTokens, recordRefreshTokenActivity } from "../services/auth/refreshService.js";
import AuthenticationError from "../errors/authenticationError.js";
import DatabaseError from "../errors/databaseError.js";

declare module "express-serve-static-core" {
	interface Request {
		user?: AccessTokenPayload;
	}
}

// Silent refresh: mint a new access token off the refresh cookie, re-set both
// cookies, and attach the payload to the request.
const refreshSession = async (
	req: Request,
	res: Response,
	incomingRefreshToken: string
) => {
	const { accessToken, refreshToken, payload } = await refreshTokens(
		incomingRefreshToken,
		{ ip: req.ip }
	);

	res.cookie("access_token", `Bearer ${accessToken}`, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		maxAge: 15 * 60 * 1000,
	});

	res.cookie("refreshToken", refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		maxAge: 7 * 24 * 60 * 60 * 1000,
	});

	req.user = payload;
};

// authenticates route to ensure a valid user can call certain routes only.
export const authenticate = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	try {
		const token = req.cookies?.access_token;
		const incomingRefreshToken = req.cookies?.refreshToken;

		if (!token) {
			// The access cookie's maxAge matches the JWT lifetime, so the browser
			// evicts it the moment it expires — a missing access token with a
			// refresh cookie present is the normal expiry case, not an anonymous
			// request. Attempt the same silent refresh as the expired-token path.
			if (!incomingRefreshToken) {
				throw new AuthenticationError("No token provided");
			}
			await refreshSession(req, res, incomingRefreshToken);
			return next();
		}

		//token ususally starts with "Bearer"
		// which will stripthe suffix leaving just the token
		const cleanToken = token.startsWith("Bearer ") ? token.slice(7) : token;

		try {
			const payload = verifyAccessToken(cleanToken);
			req.user = payload;
			// Access token is still valid — bump activity so the inactivity
			// timer reflects this request. Best-effort (never throws).
			if (incomingRefreshToken) {
				await recordRefreshTokenActivity(incomingRefreshToken);
			}
			return next();
		} catch (err) {
			if (!(err instanceof jwt.TokenExpiredError)) {
				throw new AuthenticationError("Invalid token");
			}

			// Access token expired — attempt silent refresh
			if (!incomingRefreshToken) {
				throw new AuthenticationError(
					"Session expired, please log in again"
				);
			}

			await refreshSession(req, res, incomingRefreshToken);
			next();
		}
	} catch (err) {
		if (err instanceof AuthenticationError) {
			return next(err);
		}
		if (err instanceof DatabaseError) {
			return next(err);
		}
		console.error("unexpected error:", err);
		next(new AuthenticationError("Authentication failed"));
	}
};
