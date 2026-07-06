import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
	requestPasswordResetSchema,
	resetPasswordSchema,
} from "../../schemas/authSchemas.js";
import {
	requestPasswordReset,
	resetPassword,
} from "../../services/auth/passwordResetService.js";
import { sendPasswordResetEmail } from "../../services/emailService.js";

const router = Router();

router.post(
	"/request",
	validate({ body: requestPasswordResetSchema }),
	async (req, res) => {
		const result = await requestPasswordReset(req.body.email, { ip: req.ip });

		if (result) {
			await sendPasswordResetEmail(req.body.email, result.token);
		}

		// Always return 200 to avoid leaking whether an email exists.
		res.status(200).json({
			message: "If an account with that email exists, a reset link has been sent",
		});
	}
);

router.post(
	"/reset",
	validate({ body: resetPasswordSchema }),
	async (req, res) => {
		await resetPassword(req.body.token, req.body.new_password, {
			ip: req.ip,
		});

		res.status(200).json({ message: "Password reset successful" });
	}
);

export default router;
