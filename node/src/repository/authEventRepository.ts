import { pool } from "../config/database.js";
import { DatabaseError } from "../errors/index.js";

// Application-level auth audit events (migration 20260706120000). The DB audit
// triggers only see row mutations, so auth outcomes that change no audited row
// (failed login, password-reset request, refresh failure, rate-limit block)
// are written here by the app instead. They live in audit_log under the pseudo
// table_name 'auth_events' — operation carries the event type, record_id is
// NULL, and the payload sits in new_data — so the SQS export and the retention
// sweep cover them without any pipeline changes.

export type AuthEventType =
	| "LOGIN_SUCCESS"
	| "LOGIN_FAILED"
	| "PASSWORD_RESET_REQUESTED"
	| "PASSWORD_RESET_COMPLETED"
	| "PASSWORD_RESET_FAILED"
	| "REFRESH_FAILED"
	| "SESSION_REVOKED"
	| "RATE_LIMITED";

export interface AuthEventInput {
	/** Acting/affected user when known (e.g. bad password on a real account). */
	userId?: number | null;
	/** 'user' for caller-driven outcomes; 'system' for server-initiated ones
	 *  (e.g. the inactivity rule revoking a session). */
	actionSource?: "user" | "system";
	/** Event payload stored in new_data: ip, email, reason, path, ...
	 *  Never put secrets (passwords, tokens) in here — it ships to S3. */
	detail?: Record<string, unknown>;
}

export const insertAuthEvent = async (
	type: AuthEventType,
	{ userId = null, actionSource = "user", detail = {} }: AuthEventInput = {}
): Promise<void> => {
	try {
		await pool.query(
			`INSERT INTO audit_log
			     (table_name, record_id, operation, old_data, new_data, user_id, group_id, action_source)
			 VALUES ('auth_events', NULL, $1, NULL, $2::jsonb, $3, NULL, $4)`,
			[type, JSON.stringify(detail), userId, actionSource]
		);
	} catch (e) {
		throw new DatabaseError("Failed to insert auth event", {
			type,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
