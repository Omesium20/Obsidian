import { pool } from "../config/database.js";
import { Tables } from "../config/types.js";
import { DatabaseError } from "../errors/index.js";
import { isPostgresError } from "../utils/postgressError.js";
import { ConflictError } from "../errors/index.js";

type Invitation = Tables<"invitations">;

// Inserts a new invitation row with status 'pending'.
// Stores the SHA-256 hash of the token (never the raw token) so the plaintext
// only ever lives in the email sent to the invitee.
// Called by invitationService.sendInvitation after duplicate-checking and token generation.
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

// Looks up a pending, non-expired invitation by its token hash.
// Returns undefined (not an error) when the token is unknown, already used,
// or past its expiry — callers treat all three cases the same way.
// Called by invitationService.acceptInvitation and invitationService.declineInvitation.
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

// Checks whether a pending, non-expired invitation already exists for this
// email + group combination. Used by invitationService.sendInvitation as a
// duplicate guard — if one is found, the old invitation is invalidated before
// a fresh one is created so the invitee only ever has one valid link at a time.
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

// Updates the status of an invitation and optionally records which user acted on it.
// Sets accepted_at to NOW() when status is 'accepted', NULL otherwise.
// invitee_user_id uses COALESCE so passing undefined leaves the existing value intact.
// Called by invitationService.declineInvitation to mark an invitation as 'declined'.
// (Accept flow uses acceptInvitationAndJoinGroup instead, which handles this atomically.)
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

// Atomically transitions an accepting user from their solo auto-group into the
// inviting group. Runs entirely in one transaction with a row-level lock to
// prevent concurrent accepts racing on the same membership row.
//
// Steps:
//   1. Lock the accepter's current membership row and read their group + member count.
//   2. Guard: if they're already in a real multi-member household, throw ConflictError.
//   3. DELETE their 1-member auto-group (CASCADE removes its account_group_visibility rows;
//      the user's accounts survive but become unshared until explicitly re-shared).
//   4. INSERT a new 'member' membership in the target group.
//   5. Increment the target group's member_count.
//   6. Mark the invitation accepted with accepted_at = NOW().
//
// Called by invitationService.acceptInvitation after token validation and email verification.
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
			`UPDATE groups SET member_count = member_count + 1 WHERE id = $1`,
			[groupId]
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

// Marks any pending invitation for this email + group as 'invalidated', rendering
// the old link dead before a new one is issued. Returns the invalidated row so
// callers can confirm one existed, or undefined if there was nothing to invalidate.
// Called by invitationService.sendInvitation when a re-invite is sent to an address
// that already has an outstanding invitation for the same group.
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

// Returns display-only metadata for the invitation accept/decline page:
// the inviter's full name, their group's name, the invitee's email, and the expiry.
// Joins users + groups so the frontend never has to make separate lookups.
// The invitee email is returned unmasked here — masking is applied in
// invitationService.getInvitationPreview before the response is sent.
// Called by invitationService.getInvitationPreview.
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

// Hard-deletes stale invitation rows to keep the table from growing unboundedly.
// A row is eligible when it is either resolved (accepted/declined/invalidated) or
// naturally expired, AND at least 7 days have passed since whichever of expires_at
// or accepted_at is later. The grace period means recently-closed invitations stay
// queryable for short-term audit purposes before being removed.
// Re-exported from invitationService and intended to be called on a scheduled basis
// (e.g. a cron job or admin maintenance endpoint).
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
