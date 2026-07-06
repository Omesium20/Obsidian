import { Router } from "express";
import { getUsers, getUserById, createUser } from "../../services/userServices.js";
import { getAccounts } from "../../services/accountService.js";
import { getTransactions } from "../../services/transactionService.js";
import { getGroups } from "../../services/groupService.js";
import { authenticate } from "../../middleware/authenticate.js";
import { apiRateLimit } from "../../middleware/rateLimit.js";
import { authorizeAdmin } from "../../middleware/authorizeAdmin.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../schemas/common.js";
import { createUserSchema } from "../../schemas/userSchemas.js";

const router = Router();

// All admin routes require authentication + admin role
router.use(authenticate, apiRateLimit, authorizeAdmin);

// Get all users
router.get("/users", async (_req, res) => {
	const data = await getUsers();
	res.status(200).json({
		message: "Data received successfully",
		data,
	});
});

// Get user by ID
router.get("/users/:id", validate({ params: idParamSchema }), async (req, res) => {
	const id = Number(req.params.id);

	const data = await getUserById(id);
	res.status(200).json({
		message: "Data received successfully",
		data,
	});
});

// Create user without registration flow (admin bypass)
router.post("/users", validate({ body: createUserSchema }), async (req, res) => {
	const newUser = await createUser(req.body);
	res.status(201).json({
		message: "New User created",
		user: newUser,
	});
});

// Get all accounts
router.get("/accounts", async (_req, res) => {
	const data = await getAccounts();
	res.status(200).json({
		message: "Data received successfully",
		data,
	});
});

// Get all transactions
router.get("/transactions", async (_req, res) => {
	const data = await getTransactions();
	res.status(200).json({
		message: "Data received successfully",
		data,
	});
});

// Get all groups
router.get("/groups", async (_req, res) => {
	const data = await getGroups();
	res.status(200).json({
		message: "Data received successfully",
		data,
	});
});

export default router;
