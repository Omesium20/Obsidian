import type { Response } from "express";
import { redis, redisSub } from "../../config/redis.js";

// groupId -> set of open SSE responses held by THIS process. SSE connections are
// inherently process-local (the socket lives on whichever instance the load
// balancer pinned the browser to), so this map can only ever address clients on
// the local node.
//
// To reach clients across a horizontally-scaled fleet, publishToGroup fans events
// out over a Redis pub/sub channel: every instance subscribes, and each instance
// delivers the event to its own local clients. When Redis is disabled (single
// node) we skip the round-trip and deliver locally in-process, preserving the
// original single-instance behavior.
const groupClients = new Map<number, Set<Response>>();

// One channel for all groups; the payload carries the target groupId. Simple and
// fine at this scale — every instance receives every event and filters by its
// local client map. If event volume ever makes that wasteful, switch to
// per-group channels (`obsidian:events:<groupId>`) with subscribe/unsubscribe
// driven by addClient/removeClient.
const CHANNEL = "obsidian:sync-events";

interface BusMessage {
	groupId: number;
	event: string;
	data: unknown;
}

// Register an open SSE connection under its group.
export function addClient(groupId: number, res: Response): void {
	let set = groupClients.get(groupId);
	if (!set) {
		set = new Set();
		groupClients.set(groupId, set);
	}
	set.add(res);
}

// Drop a connection (browser closed/navigated away) and clean up empty buckets.
export function removeClient(groupId: number, res: Response): void {
	const set = groupClients.get(groupId);
	if (!set) return;
	set.delete(res);
	if (set.size === 0) groupClients.delete(groupId);
}

// Write a named event to every open client for this group ON THIS PROCESS.
// Internal — the public entry point is publishToGroup.
function deliverLocal(groupId: number, event: string, data: unknown): void {
	const set = groupClients.get(groupId);
	if (!set || set.size === 0) return;

	const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	for (const res of set) {
		res.write(payload);
	}
}

// Broadcast a named event to every open client in a group, across all instances.
// With Redis: PUBLISH once; every instance (including this one) receives it via
// the subscriber below and delivers to its own clients — a single code path, so
// there's no double-delivery to dedupe. Without Redis: deliver in-process.
// Best-effort throughout — a publish failure logs and is swallowed so a sync
// completion can never fail because the notification didn't go out.
export function publishToGroup(
	groupId: number,
	event: string,
	data: unknown
): void {
	if (redis) {
		const message: BusMessage = { groupId, event, data };
		redis
			.publish(CHANNEL, JSON.stringify(message))
			.catch((e) =>
				console.error("[eventBus] redis publish failed:", e)
			);
		return;
	}
	deliverLocal(groupId, event, data);
}

// Wire the subscriber once at import. Every instance listens on CHANNEL and
// re-delivers each message to its local clients. Guarded so a single-node build
// (redisSub === null) skips this entirely.
if (redisSub) {
	redisSub.subscribe(CHANNEL).catch((e) =>
		console.error("[eventBus] redis subscribe failed:", e)
	);
	redisSub.on("message", (channel: string, raw: string) => {
		if (channel !== CHANNEL) return;
		try {
			const { groupId, event, data } = JSON.parse(raw) as BusMessage;
			deliverLocal(groupId, event, data);
		} catch (e) {
			console.error("[eventBus] dropped malformed bus message:", e);
		}
	});
}

// Close every open stream — called from the server's graceful shutdown so
// held-open connections don't keep the process alive. (Redis connections are
// closed separately via closeRedis.)
export function closeAllClients(): void {
	for (const set of groupClients.values()) {
		for (const res of set) res.end();
	}
	groupClients.clear();
}
