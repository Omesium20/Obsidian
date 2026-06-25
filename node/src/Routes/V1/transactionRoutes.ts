import { Router } from "express";
import {
	getTransactionById,
	createTransaction,
	editTransaction,
	removeTransaction,
} from "../../services/transactionService.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../schemas/common.js";
import {
	createTransactionSchema,
	updateTransactionSchema,
	deleteTransactionSchema,
} from "../../schemas/transactionSchemas.js";
import { invalidateGroupSummaries } from "../../services/cache/dashboardCache.js";

const router = Router();

// All transaction routes require authentication + group membership
router.use(authenticate, authorizeMember);

// Get transaction by ID
router.get("/:id", validate({ params: idParamSchema }), async (req, res) => {
	const data = await getTransactionById(req.user!.userId, Number(req.params.id));
	res.status(200).json({
		message: "Data received successfully",
		data,
	});
});

// Create new transaction
router.post("/", validate({ body: createTransactionSchema }), async (req, res) => {
	const { account_id, ...txBody } = req.body;
	const newTransaction = await createTransaction(
		{ ...txBody, user_id: req.user!.userId },
		account_id
	);
	// The new transaction changes this user's dashboard slices (and the group
	// aggregate). Clear before responding so the client's refetch reads fresh
	// data rather than the cached pre-write summary.
	await invalidateGroupSummaries(req.user!.groupId);
	res.status(201).json({
		message: "New Transaction created",
		transaction: newTransaction,
	});
});

// Update a transaction (manual entries only — enforced in the service)
router.patch(
	"/:id",
	validate({ params: idParamSchema, body: updateTransactionSchema }),
	async (req, res) => {
		const { account_id, ...txBody } = req.body;
		const updated = await editTransaction(
			req.user!.userId,
			Number(req.params.id),
			txBody,
			account_id
		);
		await invalidateGroupSummaries(req.user!.groupId);
		res.status(200).json({
			message: "Transaction updated",
			transaction: updated,
		});
	}
);

// Delete transaction
router.delete("/", validate({ body: deleteTransactionSchema }), async (req, res) => {
	const deletedData = await removeTransaction(req.user!.userId, req.body.id);
	await invalidateGroupSummaries(req.user!.groupId);
	res.status(200).json({
		message: "Transaction deleted",
		transaction: deletedData,
	});
});

export default router;
