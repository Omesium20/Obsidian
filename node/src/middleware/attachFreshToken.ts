import { Request, Response, NextFunction } from "express";
import { signAccessToken } from "../utils/jwt.js";

declare module "express-serve-static-core" {
	interface Locals {
		reissueToken?: boolean;
		newRole?: string | null;
		newGroupId?: number | null;
	}
}
// attaches a fresh token when getting a new permission or joining a group
export const attachFreshToken = (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	const originalJson = res.json.bind(res);

	res.json = (body) => {
		if (res.locals.reissueToken && req.user) {
			const newAccessToken = signAccessToken({
				userId: req.user.userId,
				groupId:
					res.locals.newGroupId !== undefined
						? res.locals.newGroupId
						: req.user.groupId,
				role: res.locals.newRole ?? req.user.role,
			});

			res.cookie("access_token", `Bearer ${newAccessToken}`, {
				httpOnly: true,
				secure: process.env.NODE_ENV === "production",
				sameSite: "strict",
				maxAge: 15 * 60 * 1000,
			});
		}

		return originalJson(body);
	};

	next();
};
