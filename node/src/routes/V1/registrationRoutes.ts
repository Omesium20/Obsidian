import { Router } from "express";
import { registerUser } from "../../services/auth/registrationService.js";
import { validate } from "../../middleware/validate.js";
import { registerSchema } from "../../schemas/authSchemas.js";

const router = Router();

router.post("/auth/register", validate({ body: registerSchema }), async (req, res) => {
	const { accessToken, refreshToken } = await registerUser(req.body);

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

	res.status(201).json({ message: "New User created" });
});

export default router;
