import crypto from "crypto";
import { hashToken } from "../utils/hashing.js";
import { findById, findByEmail } from "../repository/userRepository.js";
import {
	createInvitation,
	findValidInvitationByToken,
	findPendingInvitationForEmail,
	findInvitationPreviewByToken,
	invalidatePendingInvitation,
	acceptInvitationAndJoinGroup,
	updateInvitationStatus,
	purgeExpiredInvitations,
} from "../repository/invitationRepository.js";
import {
	findGroupById,
	isInSharedHousehold,
} from "../repository/groupRepository.js";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	AuthenticationError,
} from "../errors/index.js";

const INVITATION_EXPIRES_DAYS = 7;

interface InvitationResult {
	token: string;
	invitationId: number;
	inviterName: string;
	groupName: string;
}

export const sendInvitation = async (
	inviterUserId: number,
	inviterGroupId: number | null,
	inviterRole: string | null,
	inviteeEmail: string
): Promise<InvitationResult> => {
	// Every user has an auto-created group from registration; null here means
	// the JWT predates the auto-group change. Tell the user to re-authenticate.
	if (!inviterGroupId || !inviterRole) {
		throw new AuthorizationError(
			"Group context missing from session. Please sign out and back in."
		);
	}

	if (inviterRole !== "creator" && inviterRole !== "admin") {
		throw new AuthorizationError(
			"Only group creators or admins can send invitations"
		);
	}

	const [inviter, group] = await Promise.all([
		findById(inviterUserId),
		findGroupById(inviterGroupId),
	]);

	if (inviter!.email === inviteeEmail) {
		throw new ConflictError("You cannot invite yourself");
	}

	const invitee = await findByEmail(inviteeEmail);
	if (invitee) {
		// Auto-groups (1-member, self-created) don't count — those dissolve on accept.
		const inSharedHousehold = await isInSharedHousehold(invitee.id);
		if (inSharedHousehold) {
			throw new ConflictError(
				"This user is already a member of a household"
			);
		}
	}

	const existing = await findPendingInvitationForEmail(
		inviteeEmail,
		inviterGroupId
	);
	if (existing) {
		await invalidatePendingInvitation(inviteeEmail, inviterGroupId);
	}

	const rawToken = crypto.randomBytes(32).toString("hex");
	const tokenHash = hashToken(rawToken);

	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRES_DAYS);

	const invitation = await createInvitation(
		inviterUserId,
		inviteeEmail,
		inviterGroupId,
		tokenHash,
		expiresAt
	);

	return {
		token: rawToken,
		invitationId: invitation.id,
		inviterName: `${inviter!.first_name} ${inviter!.last_name}`,
		groupName: group!.name,
	};
};

export const acceptInvitation = async (
	token: string,
	acceptingUserId: number
): Promise<void> => {
	const tokenHash = hashToken(token);
	const invitation = await findValidInvitationByToken(tokenHash);

	if (!invitation) {
		throw new AuthenticationError("Invalid or expired invitation token");
	}

	const user = await findById(acceptingUserId);
	if (!user) {
		throw new NotFoundError("User", String(acceptingUserId));
	}

	if (invitation.invitee_email !== user.email) {
		throw new AuthorizationError(
			"This invitation was not sent to your email address"
		);
	}

	// The repository transactionally dissolves a 1-member auto-group and joins
	// the new group, or throws ConflictError if the user is already a real
	// household member.
	await acceptInvitationAndJoinGroup(
		invitation.id,
		invitation.group_id!,
		acceptingUserId
	);
};

export const declineInvitation = async (
	token: string,
	decliningUserId: number
): Promise<void> => {
	const tokenHash = hashToken(token);
	const invitation = await findValidInvitationByToken(tokenHash);

	if (!invitation) {
		throw new AuthenticationError("Invalid or expired invitation token");
	}

	const user = await findById(decliningUserId);
	if (!user) {
		throw new NotFoundError("User", String(decliningUserId));
	}

	if (invitation.invitee_email !== user.email) {
		throw new AuthorizationError(
			"This invitation was not sent to your email address"
		);
	}

	await updateInvitationStatus(invitation.id, "declined");
};

export const getInvitationPreview = async (rawToken: string) => {
	const tokenHash = hashToken(rawToken);
	const inv = await findInvitationPreviewByToken(tokenHash);

	if (!inv) {
		throw new NotFoundError("Invitation", rawToken);
	}

	const [local, domain] = inv.invitee_email.split("@");
	const maskedLocal = local[0] + "*".repeat(Math.min(local.length - 1, 4));
	const inviteeEmailMasked = `${maskedLocal}@${domain}`;

	return {
		inviter_name: inv.inviter_name,
		group_name: inv.group_name,
		invitee_email_masked: inviteeEmailMasked,
		expires_at: inv.expires_at,
	};
};

export { purgeExpiredInvitations };
