import {
	getAllUsers,
	newUser,
	findById,
	updateUserName,
	deleteProfile,
} from "../repository/userRepository.js";
import { getTransactionsWithAccounts } from "../repository/transactionRepository.js";
import { TablesInsert } from "../config/types.js";
import { NotFoundError } from "../errors/index.js";

export const getUsers = async () => {
	const users = await getAllUsers();
	return users;
};

export const getUserById = async (id: number) => {
	const user = await findById(id);
	if (!user) {
		throw new NotFoundError("User", String(id));
	}
	return user;
};

// Id will automatically be created, as well as the initial creation date and updated date.
// this funciton is for basic CRUD use Register User for actual user creation
export const createUser = async (newUserdata: TablesInsert<"users">) => {
	const userData = await newUser(newUserdata);
	return userData;
};

// Update the caller's own display name. The route restricts this to the
// authenticated user's own id, so any logged-in user can rename themselves.
export const updateProfile = async (
	userId: number,
	firstName: string,
	lastName: string
) => {
	const updated = await updateUserName(userId, firstName, lastName);
	if (!updated) {
		throw new NotFoundError("User", String(userId));
	}
	return updated;
};

export const removeUser = async (id: number) => {
	const deletedUser = await deleteProfile(id);
	if (!deletedUser) {
		throw new NotFoundError("User", String(id));
	}
	return deletedUser;
};

export const getMostRecentTransactions = async (
	userId: number,
	limit = 15,
	offset = 0
) => {
	const transactions = await getTransactionsWithAccounts(
		userId,
		limit,
		offset
	);
	return transactions;
};
