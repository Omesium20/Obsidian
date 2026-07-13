import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import AuthorizationError from "../errors/authorizationError.js";

// In production, CloudFront injects a shared-secret X-Origin-Verify header on
// every /api/* origin request (terraform renders the same secret into
// .env.docker.prod as ORIGIN_VERIFY_SECRET). Rejecting requests without it
// means the EC2 origin only answers traffic that actually came through
// CloudFront — anyone hitting :3000 directly gets a 403.
//
// Follows the optional-infra pattern (like REDIS_URL): env unset → no-op, so
// dev and test are unaffected. The env var is read per-request, not at module
// load, so tests can toggle it.
//
// Mounted on the /api/v1 tree only. /health is registered before this in
// app.ts and must stay outside it: the compose healthcheck hits :3000/health
// from inside the box, without the header.
export const verifyOrigin = (
	req: Request,
	_res: Response,
	next: NextFunction
) => {
	const secret = process.env.ORIGIN_VERIFY_SECRET;
	if (!secret) return next();

	// timingSafeEqual throws on length mismatch, so guard first; comparing
	// lengths leaks only the header length, not the secret's content.
	const expected = Buffer.from(secret);
	const provided = Buffer.from(req.get("x-origin-verify") ?? "");
	const match =
		provided.length === expected.length &&
		timingSafeEqual(provided, expected);

	if (!match) {
		throw new AuthorizationError("Forbidden");
	}
	next();
};
