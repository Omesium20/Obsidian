-- ============================================================================
-- Optimize the audit-export (SQS) claim query
-- ----------------------------------------------------------------------------
-- audit_log doubles as a transactional outbox for the SQS export pipeline.
-- exported_at IS NULL marks a row as not-yet-shipped (see the original table
-- migration); the relay drains the backlog oldest-first:
--
--   SELECT * FROM audit_log
--     WHERE exported_at IS NULL
--     ORDER BY changed_at ASC, id ASC
--     LIMIT n
--     FOR UPDATE SKIP LOCKED
--
-- The existing idx_audit_unexported partial index covers only the
-- (exported_at IS NULL) filter, leaving the ORDER BY to a separate sort step.
-- This partial index on (changed_at, id) with the SAME predicate serves the
-- filter AND the ordering in one index scan, so the claim reads just the oldest
-- n rows. Because the predicate excludes already-exported rows, the index only
-- ever holds the unshipped backlog — it stays small no matter how large the
-- audit history grows. id is the tiebreaker for a stable order when two rows
-- share a changed_at timestamp.
--
-- idx_audit_unexported is dropped: this index supersedes it for both the claim
-- query and any "is there unexported work?" lookup, and dropping the redundant
-- index removes its write overhead on every audit_log INSERT/UPDATE.
-- ============================================================================

CREATE INDEX idx_audit_export_queue
    ON audit_log (changed_at ASC, id ASC)
    WHERE exported_at IS NULL;

DROP INDEX IF EXISTS idx_audit_unexported;
