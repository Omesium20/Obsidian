# Plaid Integration

Files under `node/src/services/plaid/` and `node/src/routes/V1/plaidRoutes.ts`
implement bank linking, transaction sync, balance refresh, recurring streams, and
net-worth snapshots.

## Link flow (one bank)

1. `POST /api/v1/plaid/link-token` → `linkTokenService.createLinkToken(userId)` —
   calls Plaid `/link/token/create` and returns a short-lived `link_token`.
2. Frontend opens Plaid Link (via `react-plaid-link`). On success it receives a
   one-time `public_token`.
3. `POST /api/v1/plaid/exchange-token` →
   `itemService.exchangePublicToken(userId, groupId, publicToken)`:
   - Exchanges `public_token` for a long-lived `access_token` + `item_id`.
   - Fetches accounts (balances, names, mask) and institution name.
   - AES-256-GCM encrypts the `access_token` (see Encryption below).
   - In one Postgres transaction: inserts `plaid_items`, `accounts` (taxonomy
     normalized via `sanitizePlaidAccountType` — see [database.md](database.md)),
     `account_members` (`ownership_type='owner'`), and
     `account_group_visibility` for the user's current group.
   - Outside that transaction: snapshots each account's link-time balance and
     runs the initial `syncTransactions` (cursor `null` → full available history).
4. Multi-bank: the frontend re-mints a fresh `link_token` per additional
   institution; each exchange runs step 3 independently.

## OAuth institutions (Navy Federal, Chase, …)

Some US institutions authenticate on the **bank's own site**, not inside the
Link widget. That flow only works when the link token is created with a
`redirect_uri`, and it survives a full page reload:

- `createLinkToken` passes `redirect_uri` from **`PLAID_REDIRECT_URI`** when
  set (prod: `https://obsidian-secured.com/oauth-return`). The value must
  exactly match an **Allowed redirect URI** in the Plaid dashboard
  (Developers → API) — an unregistered URI makes `/link/token/create` itself
  fail for *all* institutions, so register first, deploy second. Unset =
  non-OAuth mode: OAuth banks error inside Link at institution select.
- Frontend handoff lives in `src/lib/plaidOauth.ts`: both Link call sites
  (`Onboarding` PlaidStep, `AddAccountModal`) stash
  `{ link_token, returnTo }` in sessionStorage right before `open()`, because
  the bank redirect reloads the SPA and wipes React state.
- The bank returns the user to **`/oauth-return`** (`PlaidOauthReturn` page,
  protected route). It re-initializes Link with the stashed token +
  `receivedRedirectUri: window.location.href` — Plaid requires the *same*
  token to resume — auto-opens, exchanges the `public_token` as usual, then
  navigates to `returnTo`. For onboarding it also stashes the exchange result
  so the wizard can rebuild its "connected" list after the reload.
- Non-OAuth banks never leave the page; the stash is cleared in
  `onSuccess`/`onExit` at the call sites.
- Sandbox enforces the same OAuth requirements — local OAuth testing needs
  `PLAID_REDIRECT_URI=http://localhost:5173/oauth-return` in `.env.dev` *and*
  that URI registered in the dashboard.

## Transaction sync — `transactionsSyncService.ts`

`syncTransactions(plaidItemRowId, accessToken, userId, startCursor?)`:

- Loops `/transactions/sync` until `has_more=false`, accumulating `added`,
  `modified`, `removed`.
- **added**: INSERT into `transactions` + `account_transactions`;
  `ON CONFLICT (plaid_id) DO NOTHING` makes retries idempotent.
- **modified**: UPDATE the existing row (pending → posted transitions,
  amount/date corrections).
- **removed**: DELETE by `plaid_id` (CASCADE removes `account_transactions`).
- Amount **sign is flipped** at insert and on every `modified` update (Plaid:
  positive = outflow; we store positive = inflow).
- Saves the final `next_cursor` to `plaid_items.transactions_cursor` after a
  successful commit, so the next call picks up only new deltas. Cursor `null` on
  first sync returns all available history (typically ~24 months; the 30-day
  window in sandbox is Plaid's default, not this code).

## Sync cadence & balance refresh — `scheduledSyncService.ts`

Runs on the **scheduler worker** (`worker.ts`), not the API — see
[scaling.md](scaling.md). A `node-cron` job ticks **every 30 minutes**, but a
group only syncs when **due** — `getGroupsDueForSync` returns groups where
`last_synced_at IS NULL` or older than 7 hours. Effective per-household cadence:
**~7 hours**, with 30 min polling granularity.

- `claimGroupSync`/`releaseGroupSync` use `groups.is_syncing` as a lock (one sync
  per group at a time); `resetStaleGroupLocks` clears locks older than 10 min
  left by a crashed run. Running more than one worker is therefore *safe*, just
  unnecessary.
- Per item, each sync calls `balanceRefreshService.refreshItemBalances` (Plaid
  `accountsBalanceGet` → `accounts.balance_current`/`balance_available`)
  **before** `syncTransactions`. This is the only thing that refreshes balances.
  Best-effort: logged, never blocks the transaction sync.
- After a group's sync: `invalidateGroupSummaries(groupId)` **then**
  `publishToGroup(groupId, "sync:complete", {added, modified, removed, at})` —
  cache first so the refetch can't read stale data
  ([caching.md](caching.md), [realtime-sse.md](realtime-sse.md)).
- `POST /api/v1/plaid/sync` runs the same work on demand from an API instance,
  bypassing the 7-hour gate. `GET /api/v1/plaid/sync-status` reports
  `last_synced_at`/`is_syncing`.

## Recurring streams — `recurringService.ts`

`GET /api/v1/plaid/recurring?view=…` feeds the dashboard's Subscriptions panel via
Plaid `/transactions/recurring/get`. Outflow streams only (recurring deposits are
ignored). Amounts keep Plaid's positive-cost convention since the panel shows
costs, not signed ledger entries. Each stream is enriched with `total_spent` /
`charge_count` summed from our own stored transactions (via the stream's plaid
transaction ids), so totals cover the full synced history. Per-item Plaid failures
are returned in an `errors` array rather than failing the whole panel.

## Net worth snapshots

`account_balance_snapshots` (one row per account per day,
`UNIQUE(account_id, snapshot_date)`) feeds the net-worth-over-time chart.
`balanceSnapshotRepository.upsertAccountSnapshot` upserts the day's row; called
from the balance refresh, the Plaid link insert (`itemService`), and manual
account create/edit (`accountService`). Net worth = assets − liabilities
(credit/loan negate). `dashboardRepository.getUserNetWorthSeries` /
`getGroupNetWorthSeries` build the series with last-observation carry-forward; the
line starts when snapshots begin (no historical backfill).

## Encryption — `node/src/utils/plaidCrypto.ts`

- `encryptToken(plaintext)` → `{ ciphertext, iv, tag }` (all base64), fresh
  12-byte random IV per call; `decryptToken` reverses it.
- Key from `PLAID_ENCRYPTION_KEY` (32-byte hex). The module **throws at import**
  if missing/wrong length — intentional fail-fast on misconfiguration.
- Rotating the key requires a migration that re-encrypts all `plaid_items` rows
  with the new key before the old key leaves env.

## Errors

`plaidError.ts` maps Plaid API failures onto the `AppError` hierarchy
(`ExternalServiceError`) so route responses stay uniform.
