import { Router } from "express";
import {
	getAccountById,
	createAccount,
	removeAccount,
	shareAccount,
	unshareAccount,
} from "../../services/accountService.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../schemas/common.js";
import {
	createAccountSchema,
	deleteAccountSchema,
} from "../../schemas/accountSchemas.js";

const router = Router();

// All account routes require authentication + group membership
router.use(authenticate, authorizeMember);

// Get account by ID
router.get("/:id", validate({ params: idParamSchema }), async (req, res) => {
	const data = await getAccountById(req.user!.userId, Number(req.params.id));
	res.status(200).json({
		message: "Data received successfully",
		data,
	});
});

// Create new account
router.post("/", validate({ body: createAccountSchema }), async (req, res) => {
	const newAccount = await createAccount({
		...req.body,
		user_id: req.user!.userId,
	});
	res.status(201).json({
		message: "New Account created",
		account: newAccount,
	});
});

// Delete account
router.delete(
	"/",
	validate({ body: deleteAccountSchema }),
	async (req, res) => {
		const deletedData = await removeAccount(
			req.user!.userId,
			req.body.account_id
		);
		res.status(200).json({
			message: "Account deleted",
			account: deletedData,
		});
	}
);

// Share an account with the caller's current group
router.post(
	"/:id/share",
	validate({ params: idParamSchema }),
	async (req, res) => {
		const accountId = Number(req.params.id);
		await shareAccount(req.user!.userId, accountId, req.user!.groupId!);
		res.status(200).json({
			message: "Account shared with group",
			account_id: accountId,
			group_id: req.user!.groupId,
		});
	}
);

// Unshare an account from the caller's current group
router.delete(
	"/:id/share",
	validate({ params: idParamSchema }),
	async (req, res) => {
		const accountId = Number(req.params.id);
		await unshareAccount(req.user!.userId, accountId, req.user!.groupId!);
		res.status(200).json({
			message: "Account unshared from group",
			account_id: accountId,
			group_id: req.user!.groupId,
		});
	}
);

export default router;
