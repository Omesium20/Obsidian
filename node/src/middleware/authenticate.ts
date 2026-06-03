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

// authenticates route to ensure a valid user can call certain routes only.
export const authenticate = async (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	try {
		const token = req.cookies?.access_token;

		if (!token) {
			throw new AuthenticationError("No token provided");
		}

		//token ususally starts with "Bearer"
		// which will stripthe suffix leaving just the token
		const cleanToken = token.startsWith("Bearer ") ? token.slice(7) : token;

		try {
			const payload = verifyAccessToken(cleanToken);
			req.user = payload;
			// Access token is still valid — bump activity so the inactivity
			// timer reflects this request. Best-effort (never throws).
			const refreshCookie = req.cookies?.refreshToken;
			if (refreshCookie) {
				await recordRefreshTokenActivity(refreshCookie);
			}
			return next();
		} catch (err) {
			if (!(err instanceof jwt.TokenExpiredError)) {
				throw new AuthenticationError("Invalid token");
			}

			// Access token expired — attempt silent refresh
			const incomingRefreshToken = req.cookies?.refreshToken;
			if (!incomingRefreshToken) {
				throw new AuthenticationError(
					"Session expired, please log in again"
				);
			}

			const { accessToken, refreshToken, payload } =
				await refreshTokens(incomingRefreshToken);

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
