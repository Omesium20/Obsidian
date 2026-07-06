import { Router } from "express";
import { loginUser } from "../../services/auth/loginService.js";
import { validate } from "../../middleware/validate.js";
import { loginSchema } from "../../schemas/authSchemas.js";

const router = Router();

router.post("/", validate({ body: loginSchema }), async (req, res) => {
	const { accessToken, refreshToken } = await loginUser(req.body, {
		ip: req.ip,
	});

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

	res.status(200).json({ message: "Login successful" });
});

export default router;
