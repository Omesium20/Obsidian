import { Request, Response, NextFunction } from "express";
import AuthorizationError from "../errors/authorizationError.js";
//check if admin role in token.
export const authorizeAdmin = (
	req: Request,
	_res: Response,
	next: NextFunction
) => {
	if (req.user?.role !== "admin") {
		throw new AuthorizationError("Admin access required");
	}
	next();
};
