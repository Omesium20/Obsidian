import { describe, it, expect, beforeEach } from "vitest";
import { truncateAll, seedUser, pool } from "../helpers/dbHelper.js";
import {
	storeRefreshToken,
	findRefreshToken,
} from "../../repository/refreshTokenRepository.js";
import { recordRefreshTokenActivity } from "../../services/auth/refreshService.js";
import { hashToken } from "../../utils/hashing.js";

describe("refreshService.recordRefreshTokenActivity", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	it("slides last_used_at and expires_at forward for a valid token", async () => {
		const user = await seedUser();
		const rawToken = "raw-refresh-token-abc";
		const tokenHash = hashToken(rawToken);

		// Store with a short (1-hour) expiry so we can prove it gets slid out.
		const shortExpiry = new Date(Date.now() + 60 * 60 * 1000);
		await storeRefreshToken(user.id, tokenHash, shortExpiry);

		// Backdate last_used_at so we can prove the touch advances it.
		const past = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
		await pool.query(
			"UPDATE refresh_tokens SET last_used_at = $2 WHERE token_hash = $1",
			[tokenHash, past]
		);

		// Pass the RAW token — the service must hash it before touching the row.
		await recordRefreshTokenActivity(rawToken);

		const found = await findRefreshToken(tokenHash);
		expect(found).toBeDefined();
		expect(found!.revoked_at).toBeNull();
		expect(new Date(found!.last_used_at!).getTime()).toBeGreaterThan(
			past.getTime()
		);
		// Expiry slid to ~7 days out, well past the original 1-hour expiry.
		expect(new Date(found!.expires_at).getTime()).toBeGreaterThan(
			shortExpiry.getTime()
		);
	});

	it("is a no-op (resolves, does not throw) for an unknown token", async () => {
		await expect(
			recordRefreshTokenActivity("garbage-never-stored")
		).resolves.toBeUndefined();
	});

	it("does not create a row for an unknown token", async () => {
		await recordRefreshTokenActivity("garbage-never-stored");

		const { rows } = await pool.query(
			"SELECT COUNT(*)::int AS c FROM refresh_tokens"
		);
		expect(rows[0].c).toBe(0);
	});
});
