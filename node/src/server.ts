import app from "./app.js";
import { pool } from "./config/database.js";
import { closeAllClients } from "./services/realtime/eventBus.js";
import { closeRedis } from "./config/redis.js";

const PORT = process.env.PORT || 3000;

// ============================================
// Database Connection Test
// ============================================
async function connectDatabase() {
	try {
		const client = await pool.connect();
		console.log("✅ Connected to Supabase!");
		client.release();
	} catch (error) {
		console.error("❌ Database connection failed:", error);
		process.exit(1);
	}
}

// ============================================
// Start Server
// ============================================
async function startServer() {
	try {
		// Test database connection first
		await connectDatabase();

		// Start HTTP server (importing app from app.ts)
		const server = app.listen(PORT, () => {
			console.log(`🚀 Server running on port ${PORT}`);
			console.log(
				`📍 Environment: ${process.env.NODE_ENV || "development"}`
			);
			console.log(`🔗 Health check: http://localhost:${PORT}/health`);
		});

		// NOTE: The Plaid scheduled sync no longer runs here. It lives in the
		// dedicated scheduler worker (node/src/worker.ts) so that scaling the API
		// horizontally doesn't run the cron on every instance (thundering herd).
		// API instances only handle on-demand syncs (POST /api/v1/plaid/sync) and
		// SUBSCRIBE to the worker's sync:complete events over Redis.

		// ============================================
		// Graceful Shutdown
		// ============================================
		const gracefulShutdown = async (signal: string) => {
			console.log(`\n${signal} received. Starting graceful shutdown...`);

			// Close held-open SSE streams so they don't keep the server alive.
			closeAllClients();

			server.close(async () => {
				console.log("✅ HTTP server closed");

				// Close database pool
				await pool.end();
				console.log("✅ Database pool closed");

				// Close Redis connections (no-op when Redis is disabled)
				await closeRedis();
				console.log("✅ Redis connections closed");

				console.log("👋 Graceful shutdown complete");
				process.exit(0);
			});

			// Force shutdown after 10 seconds
			setTimeout(() => {
				console.error("⚠️ Forced shutdown after timeout");
				process.exit(1);
			}, 10000);
		};

		// Listen for termination signals
		process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
		process.on("SIGINT", () => gracefulShutdown("SIGINT"));
	} catch (error) {
		console.error("❌ Failed to start server:", error);
		process.exit(1);
	}
}

// node/src/server.ts and node/src/worker.ts
// Last-resort nets: an error that escapes every handler leaves the process in
// unknown state, so log it loudly and exit — the orchestrator restarts clean.
// Node would crash anyway; these hooks buy a useful log line on the way down.
process.on("uncaughtException", (err) => {
	console.error("💥 Uncaught exception, exiting:", err);
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	console.error("💥 Unhandled rejection, exiting:", reason);
	process.exit(1);
});
startServer();
