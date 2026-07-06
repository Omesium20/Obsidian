import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { apiRateLimit } from "../../middleware/rateLimit.js";
import { authorizeMember } from "../../middleware/authorizeMember.js";
import { addClient, removeClient } from "../../services/realtime/eventBus.js";

const router = Router();

// Server-Sent Events stream. The browser's EventSource sends the auth cookies
// automatically (same-origin via the Vite proxy in dev), so this authenticates
// exactly like every other route. The connection authenticates once at the
// handshake — it is a notify-only channel; the data refetch it triggers still
// goes through full per-request auth.
router.get("/", authenticate, apiRateLimit, authorizeMember, (req, res) => {
	const groupId = req.user!.groupId;
	if (!groupId) {
		res.status(400).json({ message: "No active group" });
		return;
	}

	// SSE handshake. Keep the connection open and stream events as they arrive.
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	res.write(": connected\n\n"); // comment line opens the stream

	addClient(groupId, res);

	// Keepalive: proxies/load balancers drop idle connections. A comment every
	// 25s keeps it warm without firing a client-side event.
	const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);

	// Clean up when the tab closes or navigates away.
	req.on("close", () => {
		clearInterval(heartbeat);
		removeClient(groupId, res);
	});
});

export default router;
