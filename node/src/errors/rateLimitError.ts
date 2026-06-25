import AppError from "./appError.js";

// 429 Too Many Requests. `retryAfterSeconds` is surfaced in details and used by
// the rate-limit middleware to set the standard Retry-After header.
class RateLimitError extends AppError {
	constructor(retryAfterSeconds: number, message = "Too many requests") {
		super(message, 429, "RATE_LIMITED", true, { retryAfterSeconds });
	}
}

export default RateLimitError;
