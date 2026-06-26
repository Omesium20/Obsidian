-- ============================================================================
-- Drop session_id and ip_address from audit_log
-- ----------------------------------------------------------------------------
-- These two columns can only be populated with per-request application context
-- (the acting session and client IP), which a pure database trigger cannot see.
-- We've decided not to plumb that context through, so rather than leave two
-- permanently-NULL columns on every audit row, we remove them. The trigger
-- writer (audit_write) never inserted them — they relied on their NULL default —
-- so no function changes are needed.
-- ============================================================================

ALTER TABLE audit_log DROP COLUMN session_id;
ALTER TABLE audit_log DROP COLUMN ip_address;
