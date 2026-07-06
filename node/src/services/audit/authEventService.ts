import {
	insertAuthEvent,
	AuthEventType,
	AuthEventInput,
} from "../../repository/authEventRepository.js";

/** Per-request context the routes/middleware pass down into the auth services
 *  so events carry the caller's address. */
export interface AuthRequestContext {
	ip?: string;
}

// Best-effort audit write: an audit failure must never turn a login or refresh
// into a 500 (same policy as recordRefreshTokenActivity). Failures are logged
// and swallowed; the auth outcome itself is unaffected.
export const recordAuthEvent = async (
	type: AuthEventType,
	event: AuthEventInput = {}
): Promise<void> => {
	try {
		await insertAuthEvent(type, event);
	} catch (err) {
		console.error(`[authEvent] failed to record ${type}:`, err);
	}
};
