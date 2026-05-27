import { pool } from "../config/database.js";
import {
	getAllGroups,
	findGroupById,
	deleteGroup,
	getMembership,
	removeMember,
	createPersonalGroupForUser,
	unlinkUserAccountsFromGroup,
	listActiveMemberIds,
} from "../repository/groupRepository.js";
import {
	NotFoundError,
	AuthorizationError,
	ConflictError,
	DatabaseError,
} from "../errors/index.js";

// Get all groups in database
export const getGroups = async () => {
	const groups = await getAllGroups();
	return groups;
};

// get group by ID
export const getGroupById = async (id: number) => {
	const group = await findGroupById(id);
	if (!group) {
		throw new NotFoundError("Group", String(id));
	}
	return group;
};

// Only creator or admin can delete. Cascades memberships and visibility, then
// re-issues a fresh personal auto-group for every former member so nobody
// ends up groupless.
export const removeGroup = async (
	groupId: number,
	requestingUserId: number,
	requestingRole: string | null
) => {
	const group = await findGroupById(groupId);
	if (!group) {
		throw new NotFoundError("Group", String(groupId));
	}

	const membership = await getMembership(groupId, requestingUserId);
	if (!membership && requestingRole !== "admin") {
		throw new AuthorizationError(
			"Only the group creator can delete this group"
		);
	}

	if (
		membership &&
		membership.role !== "creator" &&
		requestingRole !== "admin"
	) {
		throw new AuthorizationError(
			"Only the group creator can delete this group"
		);
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const memberIds = await listActiveMemberIds(groupId, client);
		const deletedGroup = await deleteGroup(groupId, client);

		const newGroupIdByUser = new Map<number, number>();
		for (const memberUserId of memberIds) {
			const ng = await createPersonalGroupForUser(memberUserId, client);
			newGroupIdByUser.set(memberUserId, ng.id);
		}

		await client.query("COMMIT");

		return {
			deletedGroup,
			newGroupId: newGroupIdByUser.get(requestingUserId) ?? null,
		};
	} catch (e) {
		await client.query("ROLLBACK");
		if (
			e instanceof NotFoundError ||
			e instanceof AuthorizationError ||
			e instanceof ConflictError ||
			e instanceof DatabaseError
		) {
			throw e;
		}
		throw new DatabaseError("Failed to delete group", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}
};

// Members can leave (except creator). Admins can remove any member. Soft-departs
// the membership, removes the user's accounts from the household's visibility,
// then re-issues a fresh personal auto-group for them.
export const leaveGroup = async (
	groupId: number,
	userId: number,
	requestingRole: string | null
) => {
	const group = await findGroupById(groupId);
	if (!group) {
		throw new NotFoundError("Group", String(groupId));
	}

	const membership = await getMembership(groupId, userId);
	if (!membership) {
		throw new NotFoundError("Membership");
	}

	if (membership.role === "creator" && requestingRole !== "admin") {
		throw new ConflictError(
			"Creator cannot leave group. Transfer ownership or delete the group."
		);
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const removedMembership = await removeMember(groupId, userId, client);
		await unlinkUserAccountsFromGroup(userId, groupId, client);
		const newGroup = await createPersonalGroupForUser(userId, client);

		await client.query("COMMIT");

		return { membership: removedMembership, newGroupId: newGroup.id };
	} catch (e) {
		await client.query("ROLLBACK");
		if (
			e instanceof NotFoundError ||
			e instanceof ConflictError ||
			e instanceof DatabaseError
		) {
			throw e;
		}
		throw new DatabaseError("Failed to leave group", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}
};

// Creator (or admin) removes another member from their group. The kicked user
// gets the same dissolve+restore treatment as a voluntary leave: their accounts
// drop out of the household's visibility and they get a fresh personal group.
export const kickMember = async (
	groupId: number,
	kickingUserId: number,
	kickingRole: string | null,
	targetUserId: number
) => {
	if (kickingRole !== "creator" && kickingRole !== "admin") {
		throw new AuthorizationError(
			"Only the group creator can remove members"
		);
	}

	if (kickingUserId === targetUserId) {
		throw new ConflictError(
			"Use the leave endpoint to remove yourself from a group"
		);
	}

	const group = await findGroupById(groupId);
	if (!group) {
		throw new NotFoundError("Group", String(groupId));
	}

	const targetMembership = await getMembership(groupId, targetUserId);
	if (!targetMembership) {
		throw new NotFoundError("Membership");
	}

	if (targetMembership.role === "creator") {
		throw new ConflictError("Cannot remove the group creator");
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const removedMembership = await removeMember(
			groupId,
			targetUserId,
			client
		);
		await unlinkUserAccountsFromGroup(targetUserId, groupId, client);
		await createPersonalGroupForUser(targetUserId, client);

		await client.query("COMMIT");

		return removedMembership;
	} catch (e) {
		await client.query("ROLLBACK");
		if (
			e instanceof NotFoundError ||
			e instanceof ConflictError ||
			e instanceof AuthorizationError ||
			e instanceof DatabaseError
		) {
			throw e;
		}
		throw new DatabaseError("Failed to remove member", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}
};
