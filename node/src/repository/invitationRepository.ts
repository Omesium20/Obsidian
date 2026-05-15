import { pool } from "../config/database.js";
import { Tables } from "../config/types.js";
import { DatabaseError } from "../errors/index.js";
import { isPostgresError } from "../utils/postgressError.js";
import { ConflictError } from "../errors/index.js";

type Invitation = Tables<"invitations">;

export const createInvitation = async (
	inviterUserId: number,
	inviteeEmail: string,
	groupId: number,
	tokenHash: string,
	expiresAt: Date
): Promise<Invitation> => {
	try {
		const res = await pool.query(
			`INSERT INTO invitations (inviter_user_id, invitee_email, group_id, token, status, expires_at)
			VALUES ($1, $2, $3, $4, 'pending', $5)
			RETURNING *`,
			[inviterUserId, inviteeEmail, groupId, tokenHash, expiresAt]
		);
		return res.rows[0];
	} catch (e) {
		if (isPostgresError(e) && e.code === "23503") {
			throw new ConflictError("Referenced group or user does not exist", {
				constraint: e.constraint,
			});
		}
		throw new DatabaseError("Failed to create invitation", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export const findValidInvitationByToken = async (
	tokenHash: string
): Promise<Invitation | undefined> => {
	try {
		const res = await pool.query(
			`SELECT * FROM invitations
			WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`,
			[tokenHash]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to find invitation", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export const findPendingInvitationForEmail = async (
	inviteeEmail: string,
	groupId: number
): Promise<Invitation | undefined> => {
	try {
		const res = await pool.query(
			`SELECT * FROM invitations
			WHERE invitee_email = $1 AND group_id = $2 AND status = 'pending' AND expires_at > NOW()`,
			[inviteeEmail, groupId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to check existing invitation", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export const updateInvitationStatus = async (
	invitationId: number,
	status: string,
	inviteeUserId?: number
): Promise<Invitation> => {
	try {
		const acceptedAt = status === "accepted" ? "NOW()" : "NULL";
		const res = await pool.query(
			`UPDATE invitations
			SET status = $1, invitee_user_id = COALESCE($2, invitee_user_id), accepted_at = ${acceptedAt}
			WHERE id = $3
			RETURNING *`,
			[status, inviteeUserId ?? null, invitationId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to update invitation status", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export const acceptInvitationAndJoinGroup = async (
	invitationId: number,
	groupId: number,
	userId: number
): Promise<void> => {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const membershipRes = await client.query(
			`SELECT gm.group_id,
			        gm.role,
			        (SELECT COUNT(*) FROM group_memberships
			           WHERE group_id = gm.group_id AND departed_at IS NULL) AS member_count
			   FROM group_memberships gm
			  WHERE gm.user_id = $1 AND gm.departed_at IS NULL
			  FOR UPDATE`,
			[userId]
		);

		if (membershipRes.rows.length > 0) {
			const { group_id: oldGroupId, role, member_count } = membershipRes.rows[0];

			// Only a self-created 1-member auto-group is safe to dissolve.
			// Anything else means the user is already in a real household.
			if (role !== "creator" || Number(member_count) !== 1) {
				throw new ConflictError(
					"You are already in a household. Leave it before accepting another invite."
				);
			}

			// CASCADE removes the user's old membership and the old auto-group's
			// account_group_visibility rows. Accounts stay (FK on accounts.user_id
			// is unaffected), but they become hidden from any group until the
			// user explicitly shares them with the new household.
			await client.query(`DELETE FROM groups WHERE id = $1`, [oldGroupId]);
		}

		await client.query(
			`INSERT INTO group_memberships (group_id, user_id, role)
			VALUES ($1, $2, 'member')`,
			[groupId, userId]
		);

		await client.query(
			`UPDATE invitations
			SET status = 'accepted', invitee_user_id = $1, accepted_at = NOW()
			WHERE id = $2`,
			[userId, invitationId]
		);

		await client.query("COMMIT");
	} catch (e) {
		await client.query("ROLLBACK");
		if (e instanceof ConflictError) throw e;
		throw new DatabaseError("Failed to accept invitation", {
			cause: e instanceof Error ? e.message : String(e),
		});
	} finally {
		client.release();
	}
};

export const invalidatePendingInvitation = async (
	inviteeEmail: string,
	groupId: number
): Promise<Invitation | undefined> => {
	try {
		const res = await pool.query(
			`UPDATE invitations
			SET status = 'invalidated'
			WHERE invitee_email = $1 AND group_id = $2 AND status = 'pending'
			RETURNING *`,
			[inviteeEmail, groupId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to invalidate invitation", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export const findInvitationPreviewByToken = async (
	tokenHash: string
): Promise<{
	invitee_email: string;
	inviter_name: string;
	group_name: string;
	expires_at: Date;
} | undefined> => {
	try {
		const res = await pool.query(
			`SELECT i.invitee_email,
			        i.expires_at,
			        u.first_name || ' ' || u.last_name AS inviter_name,
			        g.name AS group_name
			   FROM invitations i
			   JOIN users u ON u.id = i.inviter_user_id
			   JOIN groups g ON g.id = i.group_id
			  WHERE i.token = $1 AND i.status = 'pending' AND i.expires_at > NOW()`,
			[tokenHash]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to fetch invitation preview", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

export const purgeExpiredInvitations = async (): Promise<number> => {
	try {
		const res = await pool.query(
			`DELETE FROM invitations
			WHERE (status IN ('accepted', 'declined', 'invalidated') OR expires_at < NOW())
			AND GREATEST(
				expires_at,
				COALESCE(accepted_at, expires_at)
			) < NOW() - INTERVAL '7 days'`
		);
		return res.rowCount ?? 0;
	} catch (e) {
		throw new DatabaseError("Failed to purge expired invitations", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
