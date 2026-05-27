import { pool } from "../config/database.js";
import { Tables } from "../config/types.js";
import { DatabaseError } from "../errors/index.js";

type PasswordResetToken = Tables<"password_reset_tokens">;

//store the password reset token so that it can be used to reset a users password when reached again.
export const storeResetToken = async (
	userId: number,
	tokenHash: string,
	expiresAt: Date
): Promise<void> => {
	try {
		await pool.query(
			`INSERT INTO password_reset_tokens (user_id, token, expires_at)
			VALUES ($1, $2, $3)`,
			[userId, tokenHash, expiresAt]
		);
	} catch (e) {
		throw new DatabaseError("Failed to store password reset token", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// search for the stored token to reset the login password.
export const findValidResetToken = async (
	tokenHash: string
): Promise<PasswordResetToken | undefined> => {
	try {
		const res = await pool.query(
			`SELECT * FROM password_reset_tokens
			WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
			[tokenHash]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to find password reset token", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// resets the password and marks the token as being used at the time of being completed
// done atomically to not cause any bugs.
export const resetPasswordAndMarkUsed = async (
	userId: number,
	passwordHash: string,
	tokenId: number
): Promise<void> => {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		await client.query(
			"UPDATE users SET password_hash = $1 WHERE id = $2",
			[passwordHash, userId]
		);

		await client.query(
			"UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
			[tokenId]
		);

		await client.query("COMMIT");
	} catch (e) {
		await client.query("ROLLBACK");
		throw new DatabaseError("Failed to reset password", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}
};

// part of a future cron job that will collect all used and expired tokens and remove them from the db.
export const purgeExpiredResetTokens = async (): Promise<number> => {
	try {
		const res = await pool.query(
			`DELETE FROM password_reset_tokens
			WHERE (expires_at < NOW() OR used_at IS NOT NULL)
			AND GREATEST(expires_at, COALESCE(used_at, expires_at)) < NOW() - INTERVAL '7 days'`
		);
		return res.rowCount ?? 0;
	} catch (e) {
		throw new DatabaseError("Failed to purge expired reset tokens", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
