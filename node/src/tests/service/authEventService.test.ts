import { describe, it, expect, beforeEach } from "vitest";
import { pool } from "../../config/database.js";
import { truncateAll, seedUser } from "../helpers/dbHelper.js";
import { recordAuthEvent } from "../../services/audit/authEventService.js";
import { loginUser } from "../../services/auth/loginService.js";
import { refreshTokens } from "../../services/auth/refreshService.js";
import { resetPassword } from "../../services/auth/passwordResetService.js";
import { hashPassword } from "../../utils/hashing.js";

// Auth events share audit_log with the trigger-written row-mutation audits
// (seedUser itself produces a users INSERT audit row), so every assertion
// filters on table_name = 'auth_events'.
const getAuthEvents = async (operation?: string) => {
	const res = await pool.query(
		`SELECT * FROM audit_log
		  WHERE table_name = 'auth_events'
		    ${operation ? "AND operation = $1" : ""}
		  ORDER BY id ASC`,
		operation ? [operation] : []
	);
	return res.rows;
};

describe("recordAuthEvent", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	it("writes an event row with NULL record_id and the payload in new_data", async () => {
		await recordAuthEvent("LOGIN_FAILED", {
			detail: { email: "x@y.com", ip: "1.2.3.4", reason: "unknown_email" },
		});

		const rows = await getAuthEvents("LOGIN_FAILED");
		expect(rows).toHaveLength(1);
		expect(rows[0].record_id).toBeNull();
		expect(rows[0].user_id).toBeNull();
		expect(rows[0].action_source).toBe("user");
		expect(rows[0].new_data).toMatchObject({
			email: "x@y.com",
			ip: "1.2.3.4",
			reason: "unknown_email",
		});
		// NULL exported_at = the row rides the SQS export outbox like any audit row.
		expect(rows[0].exported_at).toBeNull();
	});

	it("attributes the event to a user and action source when given", async () => {
		const user = await seedUser();
		await recordAuthEvent("SESSION_REVOKED", {
			userId: user.id,
			actionSource: "system",
			detail: { reason: "inactivity" },
		});

		const rows = await getAuthEvents("SESSION_REVOKED");
		expect(rows).toHaveLength(1);
		expect(rows[0].user_id).toBe(user.id);
		expect(rows[0].action_source).toBe("system");
	});
});

describe("login auditing", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	it("records LOGIN_FAILED (unknown_email) when the email has no account", async () => {
		await expect(
			loginUser({ email: "ghost@example.com", password: "whatever" }, { ip: "9.9.9.9" })
		).rejects.toThrow("Invalid credentials");

		const rows = await getAuthEvents("LOGIN_FAILED");
		expect(rows).toHaveLength(1);
		expect(rows[0].user_id).toBeNull();
		expect(rows[0].new_data).toMatchObject({
			email: "ghost@example.com",
			ip: "9.9.9.9",
			reason: "unknown_email",
		});
	});

	it("records LOGIN_FAILED (bad_password) with the account's user id", async () => {
		const user = await seedUser({
			password_hash: await hashPassword("correct-horse"),
		});

		await expect(
			loginUser({ email: user.email, password: "wrong" }, { ip: "9.9.9.9" })
		).rejects.toThrow("Invalid credentials");

		const rows = await getAuthEvents("LOGIN_FAILED");
		expect(rows).toHaveLength(1);
		expect(rows[0].user_id).toBe(user.id);
		expect(rows[0].new_data).toMatchObject({ reason: "bad_password" });
	});

	it("records LOGIN_SUCCESS on valid credentials", async () => {
		const user = await seedUser({
			password_hash: await hashPassword("correct-horse"),
		});

		await loginUser({ email: user.email, password: "correct-horse" }, { ip: "8.8.8.8" });

		const rows = await getAuthEvents("LOGIN_SUCCESS");
		expect(rows).toHaveLength(1);
		expect(rows[0].user_id).toBe(user.id);
		expect(rows[0].new_data).toMatchObject({ ip: "8.8.8.8" });
		expect(await getAuthEvents("LOGIN_FAILED")).toHaveLength(0);
	});
});

describe("refresh auditing", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	it("records REFRESH_FAILED for a token that fails JWT verification", async () => {
		await expect(refreshTokens("not-a-jwt", { ip: "9.9.9.9" })).rejects.toThrow(
			"Invalid or expired refresh token"
		);

		const rows = await getAuthEvents("REFRESH_FAILED");
		expect(rows).toHaveLength(1);
		expect(rows[0].new_data).toMatchObject({
			ip: "9.9.9.9",
			reason: "invalid_or_expired_jwt",
		});
	});
});

describe("password reset auditing", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	it("records PASSWORD_RESET_FAILED for an invalid token", async () => {
		await expect(
			resetPassword("bogus-token", "NewPassword123!", { ip: "9.9.9.9" })
		).rejects.toThrow("Invalid or expired reset token");

		const rows = await getAuthEvents("PASSWORD_RESET_FAILED");
		expect(rows).toHaveLength(1);
		expect(rows[0].new_data).toMatchObject({
			reason: "invalid_or_expired_token",
		});
	});
});
