import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
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

const router = Router();

// Public preview — returns inviter name, group name, masked invitee email (no auth)
router.get("/preview", async (req, res) => {
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
	validate({ body: acceptInvitationSchema }),
	async (req, res) => {
		await acceptInvitation(req.body.token, req.user!.userId);

		res.status(200).json({ message: "Invitation accepted" });
	}
);

// Decline invitation — requires authenticated user
router.post(
	"/decline",
	authenticate,
	validate({ body: declineInvitationSchema }),
	async (req, res) => {
		await declineInvitation(req.body.token, req.user!.userId);

		res.status(200).json({ message: "Invitation declined" });
	}
);

export default router;
