import { describe, it, expect, beforeEach } from "vitest";
import { truncateAll, seedUser } from "../helpers/dbHelper.js";
import {
	getAllGroups,
	findGroupById,
	updateGroupName,
	newGroup,
	getMembership,
	findActiveMembership,
	removeMember,
	deleteGroup,
} from "../../repository/groupRepository.js";

describe("groupRepository", () => {
	beforeEach(async () => {
		await truncateAll();
	});

	// ============================================
	// newGroup
	// ============================================

	describe("newGroup", () => {
		it("should create a group and register creator as member", async () => {
			const user = await seedUser();

			const group = await newGroup({ name: "Family", member_count: 4 }, user.id);

			expect(group).toBeDefined();
			expect(group.name).toBe("Family");
			expect(group.member_count).toBe(4);
			expect(group.id).toEqual(expect.any(Number));

			// Verify creator was added as a member
			const membership = await getMembership(group.id, user.id);
			expect(membership).toBeDefined();
			expect(membership!.role).toBe("creator");
		});

		it("should rollback if membership insert fails", async () => {
			// user_id 99999 doesn't exist, so the membership insert
			// will fail with a FK violation and the entire transaction should rollback
			await expect(
				newGroup({ name: "Ghost Group", member_count: 2 }, 99999)
			).rejects.toThrow();

			// Group should not have been created
			const groups = await getAllGroups();
			expect(groups).toHaveLength(0);
		});
	});

	// ============================================
	// getAllGroups
	// ============================================

	describe("getAllGroups", () => {
		it("should return empty array when no groups exist", async () => {
			const groups = await getAllGroups();
			expect(groups).toEqual([]);
		});

		it("should return all groups", async () => {
			const user = await seedUser();
			await newGroup({ name: "Group A", member_count: 3 }, user.id);

			// Need second user since one-group-per-user constraint
			const user2 = await seedUser({
				email: "b@test.com",
				username: "userB",
			});
			await newGroup({ name: "Group B", member_count: 5 }, user2.id);

			const groups = await getAllGroups();
			expect(groups).toHaveLength(2);
		});
	});

	// ============================================
	// findGroupById
	// ============================================

	describe("findGroupById", () => {
		it("should return the group by id", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Lookup Test", member_count: 2 },
				user.id
			);

			const found = await findGroupById(group.id);
			expect(found).toBeDefined();
			expect(found!.name).toBe("Lookup Test");
		});

		it("should return undefined for non-existent id", async () => {
			const found = await findGroupById(99999);
			expect(found).toBeUndefined();
		});
	});

	// ============================================
	// updateGroupName
	// ============================================

	describe("updateGroupName", () => {
		it("should rename the group and return the updated row", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Old Name", member_count: 1 },
				user.id
			);

			const updated = await updateGroupName(group.id, "New Name");
			expect(updated).toBeDefined();
			expect(updated!.id).toBe(group.id);
			expect(updated!.name).toBe("New Name");

			// Persisted, not just returned
			const found = await findGroupById(group.id);
			expect(found!.name).toBe("New Name");
		});

		it("should return undefined for a non-existent group", async () => {
			const updated = await updateGroupName(99999, "Nope");
			expect(updated).toBeUndefined();
		});
	});

	// ============================================
	// getMembership
	// ============================================

	describe("getMembership", () => {
		it("should return active membership", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Test Group", member_count: 3 },
				user.id
			);

			const membership = await getMembership(group.id, user.id);
			expect(membership).toBeDefined();
			expect(membership!.role).toBe("creator");
			expect(membership!.departed_at).toBeNull();
		});

		it("should not return departed memberships", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Left Group", member_count: 3 },
				user.id
			);
			await removeMember(group.id, user.id);

			const membership = await getMembership(group.id, user.id);
			expect(membership).toBeUndefined();
		});

		it("should return undefined when no membership exists", async () => {
			const user = await seedUser();
			const membership = await getMembership(99999, user.id);
			expect(membership).toBeUndefined();
		});
	});

	// ============================================
	// findActiveMembership
	// ============================================

	describe("findActiveMembership", () => {
		it("should return the user's active membership", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Active Group", member_count: 3 },
				user.id
			);

			const active = await findActiveMembership(user.id);
			expect(active).toBeDefined();
			expect(active!.group_id).toBe(group.id);
		});

		it("should return undefined when user has no active membership", async () => {
			const user = await seedUser();
			const active = await findActiveMembership(user.id);
			expect(active).toBeUndefined();
		});

		it("should not return departed memberships", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Old Group", member_count: 3 },
				user.id
			);
			await removeMember(group.id, user.id);

			const active = await findActiveMembership(user.id);
			expect(active).toBeUndefined();
		});
	});

	// ============================================
	// removeMember
	// ============================================

	describe("removeMember", () => {
		it("should set departed_at and return the membership", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Leave Group", member_count: 3 },
				user.id
			);

			const removed = await removeMember(group.id, user.id);
			expect(removed).toBeDefined();
			expect(removed!.departed_at).not.toBeNull();
		});

		it("should return undefined if already departed", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Already Left", member_count: 3 },
				user.id
			);
			await removeMember(group.id, user.id);

			// Try removing again
			const result = await removeMember(group.id, user.id);
			expect(result).toBeUndefined();
		});

		it("should return undefined for non-existent membership", async () => {
			const result = await removeMember(99999, 99999);
			expect(result).toBeUndefined();
		});
	});

	// ============================================
	// deleteGroup
	// ============================================

	describe("deleteGroup", () => {
		it("should delete the group and return it", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Delete Me", member_count: 2 },
				user.id
			);

			const deleted = await deleteGroup(group.id);
			expect(deleted).toBeDefined();
			expect(deleted!.name).toBe("Delete Me");

			// Verify actually deleted
			const found = await findGroupById(group.id);
			expect(found).toBeUndefined();
		});

		it("should cascade delete memberships", async () => {
			const user = await seedUser();
			const group = await newGroup(
				{ name: "Cascade Test", member_count: 2 },
				user.id
			);
			await deleteGroup(group.id);

			// Membership should be gone too (CASCADE)
			const membership = await findActiveMembership(user.id);
			expect(membership).toBeUndefined();
		});

		it("should return undefined for non-existent group", async () => {
			const deleted = await deleteGroup(99999);
			expect(deleted).toBeUndefined();
		});
	});
});
