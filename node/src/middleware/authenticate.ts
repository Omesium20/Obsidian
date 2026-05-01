import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken, AccessTokenPayload } from "../utils/jwt.js";
import { refreshTokens } from "../services/auth/refreshService.js";
import AuthenticationError from "../errors/authenticationError.js";

declare module "express-serve-static-core" {
	interface Request {
		user?: AccessTokenPayload;
	}
}

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

		const cleanToken = token.startsWith("Bearer ") ? token.slice(7) : token;

		try {
			const payload = verifyAccessToken(cleanToken);
			req.user = payload;
			return next();
		} catch (err) {
			if (!(err instanceof jwt.TokenExpiredError)) {
				throw new AuthenticationError("Invalid token");
			}
		}

		// Access token expired — attempt silent refresh
		const incomingRefreshToken = req.cookies?.refreshToken;
		if (!incomingRefreshToken) {
			throw new AuthenticationError(
				"Session expired, please log in again"
			);
		}

		const { accessToken, refreshToken } =
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

		const newPayload = verifyAccessToken(accessToken);
		req.user = newPayload;
		next();
	} catch (err) {
		if (err instanceof AuthenticationError) {
			return next(err);
		}
		next(new AuthenticationError("Authentication failed"));
	}
};
