import app from "./app.js";
import { pool } from "./config/database.js";
import { startScheduledSync } from "./services/plaid/scheduledSyncService.js";

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

		startScheduledSync();

		// ============================================
		// Graceful Shutdown
		// ============================================
		const gracefulShutdown = async (signal: string) => {
			console.log(`\n${signal} received. Starting graceful shutdown...`);

			server.close(async () => {
				console.log("✅ HTTP server closed");

				// Close database pool
				await pool.end();
				console.log("✅ Database pool closed");

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

// Start the server
startServer();
