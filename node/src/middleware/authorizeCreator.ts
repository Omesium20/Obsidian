import { Request, Response, NextFunction } from "express";
import AuthorizationError from "../errors/authorizationError.js";
//check if creator role in token
export const authorizeCreator = (
	req: Request,
	_res: Response,
	next: NextFunction
) => {
	if (req.user?.role !== "creator") {
		throw new AuthorizationError("Group creator access required");
	}
	next();
};
