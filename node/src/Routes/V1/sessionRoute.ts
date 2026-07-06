import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { apiRateLimit } from "../../middleware/rateLimit.js";

const router = Router();

router.get("/", authenticate, apiRateLimit, (req, res) => {
	res.status(200).json({
		userId: req.user!.userId,
		groupId: req.user!.groupId,
		role: req.user!.role,
	});
});

export default router;
