# Testing

Integration tests run against a **real local Postgres** (Supabase CLI's bundled
instance) — start it with `npx supabase start`. Native runs use `npm test`;
containerized runs use `npm run test:docker` (same `127.0.0.1` →
`host.docker.internal` override as the backend — see
[environment.md](environment.md)).

## Configuration — `vitest.config.ts`

- `dotenv.config({ path: ".env.test" })` at the **top of the file** — this must
  happen before any module imports because `database.ts` creates its pool at
  import time. The connection string and `NODE_ENV=test` come from `.env.test`.
- Named **projects**, one per test file via its `include` glob — a new test file
  needs a new project entry to be picked up. Current list in
  [commands.md](commands.md).
- `fileParallelism: false` — all projects share one database; parallel
  TRUNCATE/INSERT would deadlock. Keep this in mind when adding tests.
- `testTimeout` must be set **inside each project entry** — root-level
  `testTimeout` is not inherited by project configs in vitest 4.x.

## Global setup — `node/src/tests/globalSetup.ts`

Derives the admin connection (the `postgres` superuser DB) from the test URL and
drops/recreates `obsidian_test` from `supabase/migrations/*.sql` on every run —
migrations are the schema's single source of truth.

## Test helpers

- `node/src/tests/helpers/dbHelper.ts` — `truncateAll`, `seedUser`, `seedGroup`,
  `seedAccount`, `seedTransaction`, `seedAccountMember`,
  `seedAccountTransaction`, `seedBalanceSnapshot`,
  `seedAccountGroupVisibility`. Call `seedGroup(userId)` before `seedPlaidItem` —
  `exchangePublicToken` writes `account_group_visibility` rows that require a
  group FK.
- `node/src/tests/helpers/plaidHelper.ts` — `seedPlaidItem(userId, groupId,
  options?)`. Makes **real Plaid sandbox API calls**: creates a sandbox public
  token, runs the full `exchangePublicToken` service (accounts + initial
  transaction sync), and retries sync with backoff if transactions aren't ready
  yet (~8–10s per call). Guard throws if `PLAID_ENV !== "sandbox"`.

## Plaid integration test pattern

Use `beforeAll` (not `beforeEach`) to create **one Plaid item per `describe`
block** — each `seedPlaidItem` call takes ~8–10s of sandbox processing. Share
that item across read-only `it` cases. Tests that mutate state (deactivate,
delete) belong in their own `describe` with `beforeEach(truncateAll)` + direct
seeds. Projects using `seedPlaidItem` in `beforeAll` also need `hookTimeout`
raised (the default 10s is too short).

## Notable coverage

- Each repository/service has a matching `*.test.ts` (one project each).
- Net-worth: `balanceSnapshotRepository.test.ts` (project `balanceSnapshots`) —
  `upsertAccountSnapshot` (one row per account per day, null no-op) plus the
  net-worth series (last-observation carry-forward + credit/loan sign).
- Audit pipeline: `auditShipmentRepository.test.ts` (outbox claim/mark/purge),
  `auditShipperService.test.ts` (batch building — pure, no SQS needed),
  `authEventService.test.ts`.
- Co-ownership/visibility: `accountCoownership.test.ts`.
- Redis-backed features have no dedicated integration tests — they're
  best-effort no-ops without `REDIS_URL`, which is how tests run.
