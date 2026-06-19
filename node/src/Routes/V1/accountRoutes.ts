import { Router } from "express";
import {
	getAccountById,
	getAccountTransactions,
	createAccount,
	updateAccount,
	deleteAccount,
	removeAccount,
	setAccountVisibility,
	markAccountJoint,
	listAccountMembers,
	addCoOwner,
	removeCoOwner,
} from "../../services/accountService.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../schemas/common.js";
import {
	createAccountSchema,
	updateAccountSchema,
	deleteAccountSchema,
	deleteAccountTransferSchema,
	accountTxQuerySchema,
	accountVisibilitySchema,
	accountJointSchema,
	addCoOwnerSchema,
	memberParamSchema,
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

// Get an account's transactions (paginated). Access mirrors the dashboard: the
// caller must be a member of the account or it must be shared with their group.
router.get(
	"/:id/transactions",
	validate({ params: idParamSchema, query: accountTxQuerySchema }),
	async (req, res) => {
		const { page, filter } =
			req.query as unknown as typeof accountTxQuerySchema._output;
		const result = await getAccountTransactions(
			req.user!.userId,
			req.user!.groupId,
			Number(req.params.id),
			page,
			filter
		);
		res.status(200).json(result);
	}
);

// Create new account
router.post("/", validate({ body: createAccountSchema }), async (req, res) => {
	const newAccount = await createAccount(
		{
			...req.body,
			user_id: req.user!.userId,
		},
		req.user!.groupId
	);
	res.status(201).json({
		message: "New Account created",
		account: newAccount,
	});
});

// Update an account (manual accounts only — enforced in the service)
router.patch(
	"/:id",
	validate({ params: idParamSchema, body: updateAccountSchema }),
	async (req, res) => {
		const updated = await updateAccount(
			req.user!.userId,
			Number(req.params.id),
			req.body
		);
		res.status(200).json({
			message: "Account updated",
			account: updated,
		});
	}
);

// Deactivate (soft delete) account — keeps history, just hides it
router.delete(
	"/",
	validate({ body: deleteAccountSchema }),
	async (req, res) => {
		const deletedData = await removeAccount(
			req.user!.userId,
			req.body.account_id
		);
		res.status(200).json({
			message: "Account deactivated",
			account: deletedData,
		});
	}
);

// Remove an account from the dashboard. If the account has joint co-owners it is
// transferred to one of them (and detached from Plaid) rather than soft-deleted;
// with multiple co-owners the body must carry new_owner_user_id (the service
// returns 422 with a candidate list otherwise). Owner/joint only.
router.delete(
	"/:id",
	validate({ params: idParamSchema, body: deleteAccountTransferSchema }),
	async (req, res) => {
		const deleted = await deleteAccount(
			req.user!.userId,
			Number(req.params.id),
			req.body?.new_owner_user_id
		);
		res.status(200).json({
			message: "Account removed",
			account: deleted,
		});
	}
);

// Set an account's household visibility (public "group" vs "private")
router.put(
	"/:id/visibility",
	validate({ params: idParamSchema, body: accountVisibilitySchema }),
	async (req, res) => {
		const accountId = Number(req.params.id);
		await setAccountVisibility(
			req.user!.userId,
			accountId,
			req.user!.groupId!,
			req.body.visibility
		);
		res.status(200).json({
			message: "Account visibility updated",
			account_id: accountId,
			visibility: req.body.visibility,
		});
	}
);

// Flag/unflag an account as a (user-declared) joint account
router.put(
	"/:id/joint",
	validate({ params: idParamSchema, body: accountJointSchema }),
	async (req, res) => {
		const updated = await markAccountJoint(
			req.user!.userId,
			Number(req.params.id),
			req.body.value
		);
		res.status(200).json({ message: "Account updated", account: updated });
	}
);

// List an account's co-owners
router.get(
	"/:id/members",
	validate({ params: idParamSchema }),
	async (req, res) => {
		const members = await listAccountMembers(
			req.user!.userId,
			Number(req.params.id)
		);
		res.status(200).json({ members });
	}
);

// Link an existing household member to this account as a joint co-owner
router.post(
	"/:id/members",
	validate({ params: idParamSchema, body: addCoOwnerSchema }),
	async (req, res) => {
		const accountId = Number(req.params.id);
		await addCoOwner(
			req.user!.userId,
			accountId,
			req.user!.groupId!,
			req.body.user_id
		);
		res.status(201).json({
			message: "Co-owner linked",
			account_id: accountId,
			user_id: req.body.user_id,
		});
	}
);

// Remove a co-owner from an account
router.delete(
	"/:id/members/:userId",
	validate({ params: memberParamSchema }),
	async (req, res) => {
		const accountId = Number(req.params.id);
		await removeCoOwner(
			req.user!.userId,
			accountId,
			Number(req.params.userId)
		);
		res.status(200).json({
			message: "Co-owner removed",
			account_id: accountId,
			user_id: Number(req.params.userId),
		});
	}
);

export default router;
