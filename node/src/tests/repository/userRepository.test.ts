import { describe, it, expect, beforeEach } from "vitest";
import { truncateAll, seedUser } from "../helpers/dbHelper.js";
import {
	findById,
	findByEmail,
	getAllUsers,
	newUser,
	updateUserName,
	deleteProfile,
} from "../../repository/userRepository.js";
import { ConflictError } from "../../errors/index.js";

describe("userRepository", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	// ============================================
	// newUser
	// ============================================

	describe("newUser", () => {
		it("should create a user and return it without password_hash", async () => {
			const user = await newUser({
				email: "alice@example.com",
				username: "alice",
				password_hash: "hashed123",
				first_name: "Alice",
				last_name: "Smith",
			});

			expect(user).toBeDefined();
			expect(user.email).toBe("alice@example.com");
			expect(user.username).toBe("alice");
			expect(user.first_name).toBe("Alice");
			expect(user.last_name).toBe("Smith");
			expect(user.id).toEqual(expect.any(Number));
			expect(user.created_at).toBeDefined();
			// Should NOT return the password hash
			expect((user as Record<string, unknown>).password_hash).toBeUndefined();
		});

		it("should throw ConflictError on duplicate email", async () => {
			await newUser({
				email: "dup@example.com",
				username: "user1",
				password_hash: "hash",
				first_name: "A",
				last_name: "B",
			});

			await expect(
				newUser({
					email: "dup@example.com",
					username: "user2",
					password_hash: "hash",
					first_name: "C",
					last_name: "D",
				})
			).rejects.toThrow(ConflictError);
		});

		it("should allow duplicate usernames (no unique constraint)", async () => {
			await newUser({
				email: "a@example.com",
				username: "samename",
				password_hash: "hash",
				first_name: "A",
				last_name: "B",
			});

			const second = await newUser({
				email: "b@example.com",
				username: "samename",
				password_hash: "hash",
				first_name: "C",
				last_name: "D",
			});

			expect(second).toBeDefined();
			expect(second.username).toBe("samename");
		});
	});

	// ============================================
	// findById
	// ============================================

	describe("findById", () => {
		it("should return the user without password_hash", async () => {
			const seeded = await seedUser();
			const found = await findById(seeded.id);

			expect(found).toBeDefined();
			expect(found!.id).toBe(seeded.id);
			expect(found!.email).toBe("test@example.com");
			expect((found as Record<string, unknown>).password_hash).toBeUndefined();
		});

		it("should return undefined for non-existent id", async () => {
			const found = await findById(99999);
			expect(found).toBeUndefined();
		});
	});

	// ============================================
	// findByEmail
	// ============================================

	describe("findByEmail", () => {
		it("should return the user WITH password_hash for login", async () => {
			await seedUser({ email: "login@example.com" });
			const found = await findByEmail("login@example.com");

			expect(found).toBeDefined();
			expect(found!.email).toBe("login@example.com");
			expect(found!.password_hash).toBe("hashed_password_placeholder");
		});

		it("should return undefined for non-existent email", async () => {
			const found = await findByEmail("nobody@example.com");
			expect(found).toBeUndefined();
		});
	});

	// ============================================
	// getAllUsers
	// ============================================

	describe("getAllUsers", () => {
		it("should return empty array when no users exist", async () => {
			const users = await getAllUsers();
			expect(users).toEqual([]);
		});

		it("should return all users without password hashes", async () => {
			await seedUser({ email: "a@test.com", username: "userA" });
			await seedUser({ email: "b@test.com", username: "userB" });

			const users = await getAllUsers();
			expect(users).toHaveLength(2);
			users.forEach((user) => {
				expect(
					(user as Record<string, unknown>).password_hash
				).toBeUndefined();
			});
		});
	});

	// ============================================
	// updateUserName
	// ============================================

	describe("updateUserName", () => {
		it("should update first/last name and return the row without password_hash", async () => {
			const seeded = await seedUser();

			const updated = await updateUserName(seeded.id, "Robert", "Jones");
			expect(updated).toBeDefined();
			expect(updated!.id).toBe(seeded.id);
			expect(updated!.first_name).toBe("Robert");
			expect(updated!.last_name).toBe("Jones");
			expect(updated).not.toHaveProperty("password_hash");

			// Persisted, not just returned
			const found = await findById(seeded.id);
			expect(found!.first_name).toBe("Robert");
			expect(found!.last_name).toBe("Jones");
		});

		it("should allow an empty last name (single-word display name)", async () => {
			const seeded = await seedUser();

			const updated = await updateUserName(seeded.id, "Madonna", "");
			expect(updated!.first_name).toBe("Madonna");
			expect(updated!.last_name).toBe("");
		});

		it("should return undefined for a non-existent user", async () => {
			const updated = await updateUserName(99999, "No", "Body");
			expect(updated).toBeUndefined();
		});
	});

	// ============================================
	// deleteProfile
	// ============================================

	describe("deleteProfile", () => {
		it("should delete the user and return summary", async () => {
			const seeded = await seedUser();
			const deleted = await deleteProfile(seeded.id);

			expect(deleted).toBeDefined();
			expect(deleted!.id).toBe(seeded.id);
			expect(deleted!.username).toBe("testuser");

			// Verify actually deleted
			const found = await findById(seeded.id);
			expect(found).toBeUndefined();
		});

		it("should return undefined when deleting non-existent user", async () => {
			const deleted = await deleteProfile(99999);
			expect(deleted).toBeUndefined();
		});
	});
});
