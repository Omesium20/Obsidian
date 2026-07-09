# Database

Supabase-hosted Postgres, accessed through the `pg` driver — **no ORM**; all SQL
lives in `node/src/repository/` (one file per table/aggregate) using the shared
`pool` from `config/database.ts`. Connection string env var is `supabase`
(lowercase).

## Migrations

Schema is managed via Supabase CLI migrations in `supabase/migrations/`
(timestamped `.sql` files, applied in lexicographic order). The test global setup
rebuilds the test DB from these files on every run, so migrations are the single
source of truth for schema.

## Core tables

- `users`, `groups`, `group_memberships` — a user belongs to **one active group at
  a time** (`findActiveMembership` filters `departed_at IS NULL`); see
  [group-lifecycle.md](group-lifecycle.md).
- `accounts`, `account_members` (ownership: `owner` / `joint` /
  `authorized_user`), `account_group_visibility`
  ([account-visibility.md](account-visibility.md)), `transactions`
  (Plaid-shaped), `account_transactions`.
- `plaid_items` — one row per linked bank institution per user. Stores the
  AES-256-GCM encrypted Plaid access token across three columns
  (`access_token_ciphertext`, `access_token_iv`, `access_token_tag`) and the
  `/transactions/sync` cursor in `transactions_cursor`.
- `account_balance_snapshots` — one row per account per day
  (`UNIQUE(account_id, snapshot_date)`), feeds the net-worth chart
  ([plaid.md](plaid.md)).
- `invitations`, `password_reset_tokens`, `refresh_tokens`.
- `audit_log` — populated by DB audit triggers (`20260626120000_audit_triggers.sql`)
  and application-level auth events (`20260706120000_auth_audit_events.sql`);
  doubles as the SQS export outbox via its `exported_at` column
  ([audit-pipeline.md](audit-pipeline.md)).

## Locks & concurrency in Postgres (not Redis)

Correctness-critical coordination deliberately stays on Postgres:

- `groups.is_syncing` + `last_synced_at` — per-group Plaid sync claim lock
  (`claimGroupSync`/`releaseGroupSync`/`resetStaleGroupLocks`).
- `FOR UPDATE SKIP LOCKED` — audit shipper batch claims.
- Row locks inside the invitation-accept transaction.

## RLS & triggers

- RLS is enabled on most tables (`20251223001447_blanket_RLS.sql`,
  `20260421005059_enable_rls_refresh_tokens_audit_log.sql`).
- A trigger revokes all refresh tokens on password change
  (`20260423110202_revoke_sessions_on_password_change.sql`).
- An `updated_at` trigger stamps row updates (`20260407120000`).

## Notable column conventions

- **`accounts.type` / `accounts.subtype`** — Plaid's native account taxonomy
  stored verbatim. `type` is one of Plaid's 4 top-level types
  (`"depository" | "credit" | "loan" | "investment"`), enforced by the
  `valid_account_type` CHECK. `subtype` is Plaid's subtype (e.g. `"checking"`,
  `"credit card"`, `"401k"`) and is intentionally free-form (no DB CHECK) so a
  newly-added Plaid subtype never breaks an insert.
  `node/src/services/plaid/subtypeMap.ts` is the single source of truth for the
  taxonomy: it exports `ACCOUNT_TYPES` / `ACCOUNT_SUBTYPES` (consumed by both the
  Plaid sync path and the Zod `createAccountSchema`) and
  `sanitizePlaidAccountType()`, which normalizes Plaid's `type`/`subtype` and
  returns `null` for an unsupported top-level type (e.g. `"other"`) so the caller
  skips that account.
- **`transactions.amount`** — stored as **positive = inflow** (income, deposits,
  refunds), **negative = outflow** (purchases, withdrawals). Plaid returns the
  opposite sign (positive = outflow), so the sync service flips the sign at insert
  and on every `modified` update. Manual transactions entered by the user use the
  natural personal-finance sign (no flip).
- **`transactions.pending`** — `true` while a transaction is still pending at the
  bank. Plaid's `modified` array drives the `pending=true → false` transition when
  it posts. `account_transactions.transaction_type` (`"debit"`/`"credit"`) is
  derived from the stored (post-flip) amount sign.
- **`accounts.is_joint_declared`** — user-declared joint flag, distinct from the
  `account_members.ownership_type='joint'` rows that actually grant access.
- **`audit_log.exported_at`** — NULL = not yet shipped to SQS; stamped by the
  shipper. Unexported rows are never purged.
