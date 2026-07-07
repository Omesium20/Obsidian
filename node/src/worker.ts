import http from "http";
import { pool } from "./config/database.js";
import { startScheduledSync } from "./services/plaid/scheduledSyncService.js";
import { startAuditRetention } from "./services/audit/auditRetentionService.js";
import { startAuditShipper } from "./services/audit/auditShipperService.js";
import { closeRedis } from "./config/redis.js";

// ============================================
// Standalone scheduled-sync worker
// ============================================
// The Plaid sync scheduler used to run inside the API process (server.ts), which
// meant every horizontally-scaled API instance ran its own cron tick — a
// thundering herd all racing for the same group locks every 30 minutes. It now
// lives here, in a single dedicated container, so the cron fires once per tick.
// The Postgres claim lock still guards correctness (running >1 worker is safe),
// but one worker keeps the herd at size 1.
//
// This process is a PUBLISHER ONLY: it runs the sync and PUBLISHes sync:complete
// over Redis for the API instances to fan out to their SSE clients. It holds no
// SSE connections and never subscribes — redisSub is null here
// (WORKER_ROLE=scheduler), so eventBus's subscribe wiring no-ops.

const PORT = process.env.PORT || 3005;

// ============================================
// Database Connection Test
// ============================================
async function connectDatabase() {
	try {
		const client = await pool.connect();
		console.log("✅ [worker] Connected to Supabase!");
		client.release();
	} catch (error) {
		console.error("❌ [worker] Database connection failed:", error);
		process.exit(1);
	}
}

// ============================================
// Liveness server
// ============================================
// The worker serves no API — this minimal server exists only to give the
// container a healthcheck target. GET /health returns 200; anything else 404s.
function startHealthServer(): http.Server {
	const server = http.createServer((req, res) => {
		if (req.method === "GET" && req.url === "/health") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "OK", role: "scheduler" }));
			return;
		}
		res.writeHead(404);
		res.end();
	});
	server.listen(PORT, () => {
		console.log(
			`🩺 [worker] Health check: http://localhost:${PORT}/health`
		);
	});
	return server;
}

// ============================================
// Start Worker
// ============================================
async function startWorker() {
	try {
		// Verify DB first — same fail-fast contract as the API server.
		await connectDatabase();

		const server = startHealthServer();

		startScheduledSync();
		console.log("⏰ [worker] Scheduled sync registered (publisher-only)");

		startAuditRetention();
		console.log("🧹 [worker] Audit retention sweep registered");

		startAuditShipper();
		console.log("📤 [worker] Audit SQS shipper registered");

		// ============================================
		// Graceful Shutdown
		// ============================================
		const gracefulShutdown = async (signal: string) => {
			console.log(
				`\n[worker] ${signal} received. Starting graceful shutdown...`
			);

			server.close(async () => {
				console.log("✅ [worker] Health server closed");

				await pool.end();
				console.log("✅ [worker] Database pool closed");

				// Close Redis connections (no-op when Redis is disabled).
				await closeRedis();
				console.log("✅ [worker] Redis connections closed");

				console.log("👋 [worker] Graceful shutdown complete");
				process.exit(0);
			});

			// Force shutdown after 10 seconds.
			setTimeout(() => {
				console.error("⚠️ [worker] Forced shutdown after timeout");
				process.exit(1);
			}, 10000);
		};

		process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
		process.on("SIGINT", () => gracefulShutdown("SIGINT"));
	} catch (error) {
		console.error("❌ [worker] Failed to start:", error);
		process.exit(1);
	}
}

// Start the worker
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
startWorker();
