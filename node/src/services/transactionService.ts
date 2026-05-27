import {
	getAllTransactions,
	findById,
	newTransaction,
	deleteTransaction,
} from "../repository/transactionRepository.js";
import { TablesInsert } from "../config/types.js";
import { NotFoundError, AuthorizationError } from "../errors/index.js";

export const getTransactions = async () => {
	const transactions = await getAllTransactions();
	return transactions;
};

export const getTransactionById = async (userId: number, id: number) => {
	const transaction = await findById(id);
	if (!transaction) {
		throw new NotFoundError("Transaction", String(id));
	}
	if (transaction.user_id !== userId) {
		throw new AuthorizationError("No access to this transaction");
	}
	return transaction;
};

export const createTransaction = async (
	transactionData: TablesInsert<"transactions">
) => {
	const transaction = await newTransaction(transactionData);
	return transaction;
};

export const removeTransaction = async (userId: number, id: number) => {
	const transaction = await findById(id);
	if (!transaction) {
		throw new NotFoundError("Transaction", String(id));
	}
	if (transaction.user_id !== userId) {
		throw new AuthorizationError("No access to this transaction");
	}
	return deleteTransaction(id);
};
