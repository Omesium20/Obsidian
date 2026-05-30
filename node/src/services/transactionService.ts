import {
	getAllTransactions,
	findById,
	newTransaction,
	createManualTransaction,
	deleteTransaction,
} from "../repository/transactionRepository.js";
import { getAccountMembership } from "../repository/accountRepository.js";
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
	transactionData: TablesInsert<"transactions">,
	accountId?: number
) => {
	// No account given — fall back to the bare insert (no account link).
	if (accountId == null) {
		return newTransaction(transactionData);
	}

	// Manual entry attached to an account: only an owner or joint holder of the
	// account may record transactions against it (same rule that gates sharing).
	const membership = await getAccountMembership(
		transactionData.user_id,
		accountId
	);
	if (
		!membership ||
		(membership.ownership_type !== "owner" &&
			membership.ownership_type !== "joint")
	) {
		throw new AuthorizationError(
			"You don't have permission to add transactions to this account"
		);
	}

	return createManualTransaction(transactionData, accountId);
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
