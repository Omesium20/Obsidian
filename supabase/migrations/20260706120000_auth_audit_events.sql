-- ============================================================================
-- Auth audit events
-- ----------------------------------------------------------------------------
-- The DB audit triggers (20260626120000) capture row mutations, but auth
-- outcomes that mutate no audited row are invisible to them: failed logins,
-- password-reset requests, refresh-token failures, rate-limit blocks. An
-- attacker credential-stuffing /login would leave no trace.
--
-- The application now writes those events into audit_log directly
-- (repository/authEventRepository.ts) under the pseudo table_name
-- 'auth_events': `operation` carries the event type, `record_id` is NULL
-- (there is no underlying row), and `new_data` holds the event payload
-- (ip, email, reason, ...). Reusing audit_log means the SQS export pipeline
-- and the retention sweep cover auth events with zero changes.
-- ============================================================================

-- Event type names are longer than the original VARCHAR(10) sized for
-- INSERT/UPDATE/DELETE ('PASSWORD_RESET_REQUESTED' is 24 chars).
ALTER TABLE audit_log ALTER COLUMN operation TYPE VARCHAR(30);

-- Auth events have no underlying row to point at...
ALTER TABLE audit_log ALTER COLUMN record_id DROP NOT NULL;

-- ...but row-mutation audits must still carry one.
ALTER TABLE audit_log ADD CONSTRAINT record_id_present_for_row_audits
    CHECK (table_name = 'auth_events' OR record_id IS NOT NULL);

ALTER TABLE audit_log DROP CONSTRAINT valid_table_name;
ALTER TABLE audit_log ADD CONSTRAINT valid_table_name CHECK (table_name IN (
    'users',
    'accounts',
    'transactions',
    'groups',
    'account_members',
    'group_memberships',
    'account_group_visibility',
    'invitations',
    'plaid_items',
    'auth_events'
));

ALTER TABLE audit_log DROP CONSTRAINT valid_operation;
ALTER TABLE audit_log ADD CONSTRAINT valid_operation CHECK (operation IN (
    'INSERT', 'UPDATE', 'DELETE',
    -- auth event types (table_name = 'auth_events' rows only)
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'PASSWORD_RESET_REQUESTED',
    'PASSWORD_RESET_COMPLETED',
    'PASSWORD_RESET_FAILED',
    'REFRESH_FAILED',
    'SESSION_REVOKED',
    'RATE_LIMITED'
));

-- Keep the two row shapes from mixing: auth_events rows must use an auth event
-- type, and row-mutation rows must use INSERT/UPDATE/DELETE.
ALTER TABLE audit_log ADD CONSTRAINT auth_event_operation_matches
    CHECK ((table_name = 'auth_events') = (operation NOT IN ('INSERT', 'UPDATE', 'DELETE')));

-- Anomaly queries ("failed logins in the last 15 minutes") scan by event type
-- and recency. Partial index keeps it clear of the high-volume row-mutation
-- audit traffic (Plaid transaction syncs).
CREATE INDEX idx_audit_auth_events
    ON audit_log (operation, changed_at DESC)
    WHERE table_name = 'auth_events';
