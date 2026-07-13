import { Router, Request, Response } from "express";
import { logoutUser } from "../../services/auth/logoutService.js";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
	const refreshToken = req.cookies?.refreshToken;

	if (refreshToken) {
		await logoutUser(refreshToken);
	}

	res.clearCookie("access_token");
	res.clearCookie("refreshToken");

	res.status(200).json({ message: "Logged out successfully" });
});

export default router;
