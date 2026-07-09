# Realtime: SSE + Redis Pub/Sub

Live dashboard refresh without polling: when a household's Plaid sync finishes,
every member's open dashboard refetches its summary. Server-Sent Events (one-way
server→browser) rather than WebSockets — it's notify-only, auto-reconnects, and
rides the existing cookie auth.

## The stream — `GET /api/v1/events` (`routes/V1/eventsRoutes.ts`)

- Authenticates like any other route (`authenticate` → `apiRateLimit` →
  `authorizeMember`); the browser's `EventSource` sends the auth cookies
  automatically (same-origin via the Vite proxy in dev).
- Auth happens **once at the handshake** — acceptable because the channel is
  notify-only; the refetch it triggers still goes through full per-request auth.
- SSE handshake (`text/event-stream`, `no-cache`, `keep-alive`), then the
  connection is registered in the event bus under the user's `groupId`.
- A `: ping` comment every 25s keeps proxies/load balancers from dropping the
  idle connection.
- `req.on("close")` clears the heartbeat and deregisters the client.

## The event bus — `services/realtime/eventBus.ts`

- `groupClients: Map<groupId, Set<Response>>` — the open SSE responses held by
  **this process**. Sockets are inherently process-local (the LB pinned the
  browser to one instance), so this map can only address local clients.
- `publishToGroup(groupId, event, data)` — the single publish entry point:
  - **With Redis**: `PUBLISH` a `{groupId, event, data}` JSON message on the
    single channel `obsidian:sync-events`. Every API instance (including the
    publisher) receives it via its subscriber connection and delivers to its own
    local clients — one code path, so there's no double-delivery to dedupe.
  - **Without Redis** (single node): deliver in-process directly.
  - Best-effort throughout — a publish failure logs and is swallowed; a sync can
    never fail because its notification didn't go out.
- One channel for all groups; each instance filters by its local client map. If
  event volume ever makes that wasteful, switch to per-group channels
  (`obsidian:events:<groupId>`) with subscribe/unsubscribe driven by
  `addClient`/`removeClient`.
- `closeAllClients()` — ends every open stream during graceful shutdown so
  held-open connections don't keep the process alive.

## Who publishes, who subscribes

- **Scheduler worker** (`worker.ts`, `WORKER_ROLE=scheduler`): publisher-only.
  After each group sync it invalidates the group's cached summaries and publishes
  `sync:complete` with `{ added, modified, removed, at }`. It opens no subscriber
  connection ([redis.md](redis.md)).
- **API instances**: subscribe on import of `eventBus`, and also publish when an
  on-demand `POST /plaid/sync` completes.
- **Ordering matters**: cache invalidation happens **before** the publish so the
  refetch triggered by the event can't read a stale cache entry
  ([caching.md](caching.md)).

## Client side

`subscribeToSync(onSync)` in `src/lib/api.ts` opens the `EventSource` and parses
`sync:complete` payloads (`SyncCompleteEvent`); `Dashboard` refetches its summary
on each event. See [frontend-architecture.md](frontend-architecture.md).

## Adding a new event type

1. Pick an event name (`"foo:bar"`) and payload shape.
2. Call `publishToGroup(groupId, "foo:bar", payload)` server-side — no bus changes
   needed; the channel is shared.
3. Add a typed `es.addEventListener("foo:bar", …)` subscription client-side.
4. If the event reflects data a cached endpoint serves, invalidate that cache
   before publishing.
