import { describe, it, expect, beforeEach } from "vitest";
import { truncateAll, seedUser, pool } from "../helpers/dbHelper.js";
import {
	storeRefreshToken,
	findRefreshToken,
	touchRefreshToken,
	revokeRefreshToken,
	revokeAllUserRefreshTokens,
} from "../../repository/refreshTokenRepository.js";

describe("refreshTokenRepository", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	// ============================================
	// storeRefreshToken
	// ============================================

	describe("storeRefreshToken", () => {
		it("should store a refresh token", async () => {
			const user = await seedUser();
			const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

			// Should not throw
			await storeRefreshToken(user.id, "token_hash_123", expiresAt);

			// Verify it was stored
			const found = await findRefreshToken("token_hash_123");
			expect(found).toBeDefined();
			expect(found!.user_id).toBe(user.id);
			expect(found!.token_hash).toBe("token_hash_123");
		});
	});

	// ============================================
	// findRefreshToken
	// ============================================

	describe("findRefreshToken", () => {
		it("should find a valid, non-revoked, non-expired token", async () => {
			const user = await seedUser();
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
			await storeRefreshToken(user.id, "valid_token", expiresAt);

			const found = await findRefreshToken("valid_token");
			expect(found).toBeDefined();
			expect(found!.token_hash).toBe("valid_token");
			expect(found!.revoked_at).toBeNull();
		});

		it("should not find an expired token", async () => {
			const user = await seedUser();
			const expiredAt = new Date(Date.now() - 1000); // 1 second ago
			await storeRefreshToken(user.id, "expired_token", expiredAt);

			const found = await findRefreshToken("expired_token");
			expect(found).toBeUndefined();
		});

		it("should not find a revoked token", async () => {
			const user = await seedUser();
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
			await storeRefreshToken(user.id, "revoked_token", expiresAt);
			await revokeRefreshToken("revoked_token");

			const found = await findRefreshToken("revoked_token");
			expect(found).toBeUndefined();
		});

		it("should return undefined for non-existent token", async () => {
			const found = await findRefreshToken("does_not_exist");
			expect(found).toBeUndefined();
		});
	});

	// ============================================
	// touchRefreshToken
	// ============================================

	describe("touchRefreshToken", () => {
		it("should bump last_used_at and slide expires_at without revoking", async () => {
			const user = await seedUser();
			const oldExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
			await storeRefreshToken(user.id, "active_token", oldExpiry);

			const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
			await touchRefreshToken("active_token", newExpiry);

			// Still findable (not revoked) and activity/expiry updated
			const found = await findRefreshToken("active_token");
			expect(found).toBeDefined();
			expect(found!.revoked_at).toBeNull();
			expect(found!.last_used_at).not.toBeNull();
			expect(new Date(found!.expires_at).getTime()).toBeGreaterThan(
				oldExpiry.getTime()
			);
		});
	});

	// ============================================
	// revokeRefreshToken
	// ============================================

	describe("revokeRefreshToken", () => {
		it("should set revoked_at on the token", async () => {
			const user = await seedUser();
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
			await storeRefreshToken(user.id, "to_revoke", expiresAt);

			await revokeRefreshToken("to_revoke");

			// Token should no longer be findable (revoked)
			const found = await findRefreshToken("to_revoke");
			expect(found).toBeUndefined();

			// But it still exists in the table with revoked_at set
			const raw = await pool.query(
				"SELECT * FROM refresh_tokens WHERE token_hash = $1",
				["to_revoke"]
			);
			expect(raw.rows[0].revoked_at).not.toBeNull();
		});
	});

	// ============================================
	// revokeAllUserRefreshTokens
	// ============================================

	describe("revokeAllUserRefreshTokens", () => {
		it("should revoke all tokens for a user", async () => {
			const user = await seedUser();
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

			await storeRefreshToken(user.id, "session_1", expiresAt);
			await storeRefreshToken(user.id, "session_2", expiresAt);
			await storeRefreshToken(user.id, "session_3", expiresAt);

			await revokeAllUserRefreshTokens(user.id);

			// None should be findable
			expect(await findRefreshToken("session_1")).toBeUndefined();
			expect(await findRefreshToken("session_2")).toBeUndefined();
			expect(await findRefreshToken("session_3")).toBeUndefined();
		});

		it("should not revoke tokens belonging to other users", async () => {
			const user1 = await seedUser();
			const user2 = await seedUser({
				email: "other@example.com",
				username: "otheruser",
			});
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

			await storeRefreshToken(user1.id, "user1_token", expiresAt);
			await storeRefreshToken(user2.id, "user2_token", expiresAt);

			await revokeAllUserRefreshTokens(user1.id);

			// user1's token revoked
			expect(await findRefreshToken("user1_token")).toBeUndefined();
			// user2's token untouched
			const found = await findRefreshToken("user2_token");
			expect(found).toBeDefined();
			expect(found!.user_id).toBe(user2.id);
		});
	});
});
