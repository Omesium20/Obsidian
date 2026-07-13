import { Router } from "express";
import { removeUser, updateProfile } from "../../services/userServices.js";
import { getMostRecentTransactions } from "../../services/userServices.js";
import { authenticate } from "../../middleware/authenticate.js";
import { apiRateLimit } from "../../middleware/rateLimit.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { paginationQuerySchema } from "../../schemas/common.js";
import { deleteUserSchema, updateProfileSchema } from "../../schemas/userSchemas.js";

const router = Router();

// All user routes require authentication + group membership
router.use(authenticate, apiRateLimit, authorizeMember);

// Update own display name (any authenticated user, own account only)
router.patch("/", validate({ body: updateProfileSchema }), async (req, res) => {
	const user = await updateProfile(
		req.user!.userId,
		req.body.first_name,
		req.body.last_name
	);
	res.status(200).json({
		message: "Profile updated",
		user,
	});
});

// Delete user (own account)
router.delete("/", validate({ body: deleteUserSchema }), async (req, res) => {
	const deletedData = await removeUser(req.user!.userId);
	res.status(200).json({
		message: "User Deleted",
		user: deletedData,
	});
});

// Get own transactions with account details
// Supports pagination via query params: ?limit=15&offset=0
router.get("/me/transactions", validate({ query: paginationQuerySchema }), async (req, res) => {
	const { limit, offset } = req.query as unknown as { limit: number; offset: number };

	const data = await getMostRecentTransactions(req.user!.userId, limit, offset);
	res.status(200).json({
		message: "User transactions with account data received successfully",
		data,
		pagination: { limit, offset },
	});
});

export default router;
