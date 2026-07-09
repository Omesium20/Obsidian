# Audit Pipeline (audit_log → SQS → Lambda → S3)

Addresses OWASP A09 (logging & monitoring failures): every audited change is
captured in Postgres, durably archived to S3, and kept queryable for a short hot
window without letting the table grow unbounded.

```
DB triggers ─┐
             ├─► audit_log (outbox, exported_at NULL)
auth events ─┘        │  scheduler worker, every 30s
                      ▼
        claim batch (FOR UPDATE SKIP LOCKED)
                      ▼
        SendMessageBatch → audit-export.fifo ──► Lambda audit-archiver ──► S3
                      │                              │ (per-message failures)
        stamp exported_at on accepted rows           ▼ after 5 attempts
                      ▼                        audit-export-dlq.fifo
        daily 03:00 sweep purges exported rows > 7 days old
```

## Sources of audit rows

- **DB audit triggers** (`20260626120000_audit_triggers.sql`) — row-level
  old/new snapshots into `audit_log` for audited tables.
- **Application-level auth events** (`services/audit/authEventService.ts` →
  `authEventRepository`) — logins, refreshes, resets, `RATE_LIMITED`, etc., with
  `table_name='auth_events'`. `recordAuthEvent` is best-effort: an audit failure
  must never turn a login into a 500.

## Shipper — `services/audit/auditShipperService.ts` (scheduler worker)

Drains the `audit_log` outbox to the SQS FIFO queue every 30s
(`SHIP_INTERVAL_MS`), up to 20 batches of 10 per tick, with a reentrancy guard so
a slow drain never overlaps the next tick.

One drain pass, in **one transaction**: claim a batch of unexported rows
(`FOR UPDATE SKIP LOCKED` — parallel shippers can't double-claim), send with
`SendMessageBatch`, stamp `exported_at` on only the rows SQS accepted. A thrown
send ROLLBACKs (rows retry next tick); a partial failure marks only the accepted
rows.

**Delivery is at-least-once**, deduped:

- `MessageDeduplicationId` = the audit row id — a crash between "SQS accepted"
  and COMMIT re-sends the row, and SQS drops it inside its 5-minute dedup window;
  idempotent S3 keys cover the rare gap beyond it.
- `MessageGroupId` = `<table>:<record_id>` — FIFO orders strictly *within* a
  group, giving an ordered change-history per audited record while different
  records flow in parallel. Auth events share the `auth_events:-` group so the
  auth stream itself stays ordered (useful for attack timelines).

Disabled cleanly when `SQS_AUDIT_QUEUE_URL` is unset — rows just accumulate
unexported ([environment.md](environment.md)).

## Lambda — `lambda/audit-archiver/index.mjs`

Triggered by the SQS event-source mapping (batch size 10,
`ReportBatchItemFailures`). Writes each message verbatim to S3 under a
**deterministic key** built only from the row's immutable fields:

```
<table>/<record_id>/<changed_at>-<id>.json
```

- Grouping by table + record puts a record's full history under one prefix,
  `changed_at` makes listing it a sorted timeline, and the row id makes the key
  unique **and idempotent** — a duplicate delivery overwrites the identical
  object instead of creating a copy.
- Failures are reported per-message (`batchItemFailures`), so only failed
  messages retry; after the queue's `maxReceiveCount` (5) they redrive to
  `audit-export-dlq.fifo`.
- The SDK reads `AWS_ENDPOINT_URL` natively, so the same code targets LocalStack
  in dev and real AWS in prod.

## Retention — `services/audit/auditRetentionService.ts` (scheduler worker)

Daily 03:00 cron purges **exported** rows older than 7 days
(`purgeExportedOlderThan`). Unexported rows are **never** deleted — a broken
shipper or SQS outage shows up as a growing backlog, not as lost audit events.

## Repository

`repository/auditShipmentRepository.ts` — `claimUnexportedBatch`,
`markBatchExported`, `purgeExportedOlderThan`, backed by the export claim index
(`20260626140000_audit_export_claim_index.sql`).

## Dev vs prod

Dev runs the whole pipeline against LocalStack (queues + Lambda + bucket
provisioned by `scripts/localstack/` on startup — see
[environment.md](environment.md)). Prod points at real AWS by leaving
`AWS_ENDPOINT_URL` unset; credentials come from the EC2 instance role, so no AWS
secrets live in env files.
