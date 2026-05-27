import {
	DatabaseError,
	ConflictError,
	ValidationError,
} from "../errors/index.js";
import { pool } from "../config/database.js";
import { Tables, TablesInsert } from "../config/types.js";
import { isPostgresError } from "../utils/postgressError.js";

// ============================================
// Types
// ============================================

type User = Tables<"users">;
type UserSensitive = Omit<User, "password_hash">;
type UserSummary = Pick<User, "id" | "username" | "first_name" | "last_name">;

// ============================================
// Repository Functions
// ============================================

// Find user by ID
export const findById = async (
	userId: number
): Promise<UserSensitive | undefined> => {
	try {
		const res = await pool.query(
			"SELECT id, email, username, first_name, last_name, created_at, updated_at FROM users WHERE id = $1",
			[userId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to fetch user", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
// Find password hash for login functionality
export const findByEmail = async (email: string): Promise<User | undefined> => {
	try {
		const res = await pool.query(
			"SELECT id, email, username, password_hash, first_name, last_name, created_at, updated_at FROM users WHERE email = $1",
			[email]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Failed to fetch user", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Get all users in the database.
export const getAllUsers = async (): Promise<UserSensitive[]> => {
	try {
		const res = await pool.query(
			"SELECT id, email, username, first_name, last_name, created_at, updated_at FROM users"
		);
		return res.rows;
	} catch (e) {
		throw new DatabaseError("Failed to fetch users", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Create a new user
export const newUser = async (
	userData: TablesInsert<"users">
): Promise<UserSensitive> => {
	try {
		const res = await pool.query(
			`INSERT INTO users (email, username, password_hash, first_name, last_name)
			VALUES($1, $2, $3, $4, $5)
			RETURNING id, email, username, first_name, last_name, created_at, updated_at`,
			[
				userData.email,
				userData.username,
				userData.password_hash,
				userData.first_name,
				userData.last_name,
			]
		);
		return res.rows[0];
	} catch (e) {
		if (isPostgresError(e)) {
			if (e.code === "23505") {
				throw new ConflictError("Email or username already exists", {
					constraint: e.constraint,
					detail: e.details,
				});
			}
			if (e.code === "23502") {
				throw new ValidationError("Required field is missing", {
					column: e.column,
				});
			}
		}
		throw new DatabaseError("Failed to create user", {
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};

// Delete user profile
export const deleteProfile = async (
	userId: number
): Promise<UserSummary | undefined> => {
	try {
		const res = await pool.query(
			"DELETE FROM USERS WHERE ID = $1 RETURNING id, username, first_name, last_name",
			[userId]
		);
		return res.rows[0];
	} catch (e) {
		throw new DatabaseError("Deletion of user failed", {
			userId,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
};
