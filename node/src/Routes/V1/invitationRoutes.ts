import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { apiRateLimit, authRateLimit } from "../../middleware/rateLimit.js";
import {
	createInvitationSchema,
	acceptInvitationSchema,
	declineInvitationSchema,
} from "../../schemas/invitationSchemas.js";
import {
	sendInvitation,
	acceptInvitation,
	declineInvitation,
	getInvitationPreview,
} from "../../services/invitationService.js";
import { sendInvitationEmail } from "../../services/emailService.js";
import { ValidationError } from "../../errors/index.js";
import { findActiveMembership } from "../../repository/groupRepository.js";
import { signAccessToken } from "../../utils/jwt.js";
import { issueRefreshToken } from "../../services/auth/refreshService.js";

const router = Router();

// Public preview — returns inviter name, group name, masked invitee email (no auth).
// authRateLimit because the token query param is a guessable secret.
router.get("/preview", authRateLimit, async (req, res) => {
	const { token } = req.query;
	if (typeof token !== "string" || !token) {
		throw new ValidationError("token query parameter is required");
	}
	const preview = await getInvitationPreview(token);
	res.status(200).json(preview);
});

// Send or resend invitation — requires authenticated creator/admin
router.post(
	"/",
	authenticate,
	apiRateLimit,
	validate({ body: createInvitationSchema }),
	async (req, res) => {
		const { token, invitationId, inviterName, groupName } = await sendInvitation(
			req.user!.userId,
			req.user!.groupId,
			req.user!.role,
			req.body.invitee_email
		);

		await sendInvitationEmail(req.body.invitee_email, inviterName, groupName, token);

		res.status(201).json({
			message: "Invitation sent",
			invitationId,
		});
	}
);

// Accept invitation — requires authenticated user
router.post(
	"/accept",
	authenticate,
	apiRateLimit,
	validate({ body: acceptInvitationSchema }),
	async (req, res) => {
		await acceptInvitation(req.body.token, req.user!.userId);

		// Re-issue tokens so the new groupId is live before the next request.
		// Without this, the access token still carries the now-deleted personal
		// groupId, which breaks exchangePublicToken's account_group_visibility insert.
		const membership = await findActiveMembership(req.user!.userId);
		const accessToken = signAccessToken({
			userId: req.user!.userId,
			groupId: membership?.group_id ?? null,
			role: membership?.role ?? null,
		});
		const refreshToken = await issueRefreshToken(req.user!.userId);

		res.cookie("access_token", `Bearer ${accessToken}`, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			maxAge: 15 * 60 * 1000,
		});
		res.cookie("refreshToken", refreshToken, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			maxAge: 7 * 24 * 60 * 60 * 1000,
		});

		res.status(200).json({ message: "Invitation accepted" });
	}
);

// Decline invitation — requires authenticated user
router.post(
	"/decline",
	authenticate,
	apiRateLimit,
	validate({ body: declineInvitationSchema }),
	async (req, res) => {
		await declineInvitation(req.body.token, req.user!.userId);

		res.status(200).json({ message: "Invitation declined" });
	}
);

export default router;
