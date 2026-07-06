import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import AppError from "./errors/appError.js";
import ValidationError from "./errors/validationError.js";
import v1Routes from "./routes/V1/index.js";
import helmet from "helmet";

const app = express();

// One proxy hop (the load balancer) in front of the app: req.ip resolves to the
// client address from X-Forwarded-For instead of the LB's address, which the
// IP-keyed rate limiters depend on. Harmless when no proxy is present.
app.set("trust proxy", 1);

// ============================================
// Middleware
// ============================================
// Helmet mounts first so every response gets the headers — even errors thrown
// by the body/cookie parsers below (middleware only runs for a request if it
// was registered before the point where the response was produced).
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

// ============================================
// Routes
// ============================================
app.get("/health", (_req, res) => {
	res.status(200).json({
		status: "OK",
		timestamp: new Date().toISOString(),
	});
});

app.get("/", (_req, res) => {
	res.send("Hello world!");
});

// API v1 routes
app.use("/api/v1", v1Routes);

// ============================================
// Error Handling
// ============================================
app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
	// express.json() rejects malformed JSON with a SyntaxError tagged
	// type "entity.parse.failed" — a client mistake, not a server fault.
	// Normalize it to the standard ValidationError shape instead of letting
	// it fall through to the 500 branch.
	if ((err as { type?: string }).type === "entity.parse.failed") {
		err = new ValidationError("Malformed JSON in request body");
	}
	if (err instanceof AppError) {
		return res.status(err.statusCode).json({
			status: "error",
			errorCode: err.errorCode,
			message: err.message,
			details: err.details,
			timestamp: err.timestamp,
		});
	}
	// Unknown/unexpected error - don't leak details
	console.error(err.stack);
	return res.status(500).json({
		status: "error",
		errorCode: "INTERNAL_ERROR",
		message: "An unexpected error occurred",
	});
	next();
});

export default app;
