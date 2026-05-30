import { Router } from "express";
import {
	getTransactionById,
	createTransaction,
	removeTransaction,
} from "../../services/transactionService.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../schemas/common.js";
import { createTransactionSchema, deleteTransactionSchema } from "../../schemas/transactionSchemas.js";

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
	res.status(201).json({
		message: "New Transaction created",
		transaction: newTransaction,
	});
});

// Delete transaction
router.delete("/", validate({ body: deleteTransactionSchema }), async (req, res) => {
	const deletedData = await removeTransaction(req.user!.userId, req.body.id);
	res.status(200).json({
		message: "Transaction deleted",
		transaction: deletedData,
	});
});

export default router;
