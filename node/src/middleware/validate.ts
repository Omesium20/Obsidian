import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ValidationError } from "../errors/index.js";

interface ValidationSchemas {
	body?: z.ZodType;
	params?: z.ZodType;
	query?: z.ZodType;
}

//checks for request parameters
export const validate = (schemas: ValidationSchemas) => {
	return (req: Request, _res: Response, next: NextFunction) => {
		if (schemas.params) {
			const result = schemas.params.safeParse(req.params);
			if (!result.success) {
				throw new ValidationError("Invalid URL parameters", {
					errors: result.error.issues,
				});
			}
			req.params = result.data as typeof req.params;
		}
		//checks for request query parameters
		if (schemas.query) {
			const result = schemas.query.safeParse(req.query);
			if (!result.success) {
				throw new ValidationError("Invalid query parameters", {
					errors: result.error.issues,
				});
			}
			Object.assign(req.query, result.data);
		}
		//checks for body values
		if (schemas.body) {
			const result = schemas.body.safeParse(req.body);
			if (!result.success) {
				throw new ValidationError("Invalid request body", {
					errors: result.error.issues,
				});
			}
			req.body = result.data;
		}

		next();
	};
};
