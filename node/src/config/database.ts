import { Client, Pool } from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Skip dotenv loading if connection string is already set (e.g., in test environment)
if (!process.env.supabase) {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	dotenv.config({ path: join(__dirname, "../../../.env.dev") });
}

/**Connection string for Supabase */
const connectionString = process.env.supabase;
if (!connectionString) {
	throw new Error("supabase environment variable is not defined");
}

// Create and export the database pool
export const pool = new Pool({
	connectionString,
	max: 20, // Maximum number of clients in the pool
	idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
	connectionTimeoutMillis: 2000, // Return error after 2 seconds if can't connect
});

export const client = new Client({
	connectionString,
	statement_timeout: 30000,
	connectionTimeoutMillis: 2000,
	idle_in_transaction_session_timeout: 30000,
});

// Handle pool errors
pool.on("error", (err) => {
	console.error("Unexpected error on idle client", err);
	process.exit(-1);
});
