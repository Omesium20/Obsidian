-- ============================================================================
-- Audit triggers
-- ----------------------------------------------------------------------------
-- Populates `audit_log` (created in 20260412120000) via AFTER ROW triggers on
-- the security-sensitive tables. Each audited table gets a dedicated trigger
-- function so the "what's worth recording" rules can be expressed per table.
--
-- Actor context: these are pure database triggers, so they capture only what
-- the row itself reveals. `user_id`/`group_id` are pulled off the changed row
-- where such a column exists, and `action_source` is inferred from row signals
-- (transactions.entry_method, accounts.plaid_account_id, plaid_items = plaid).
-- `session_id` and `ip_address` are not knowable at the DB layer and are left
-- NULL — the app can enrich these later by setting session GUCs if desired.
--
-- Because the audit row is written inside the same transaction as the change,
-- a rolled-back change rolls back its audit row too: we only ever record
-- committed mutations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Allow plaid_items as an audited table (the original CHECK predates it).
-- ----------------------------------------------------------------------------
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
    'plaid_items'
));

-- ----------------------------------------------------------------------------
-- Shared writer. SECURITY DEFINER so an audit insert is never blocked by RLS
-- on audit_log regardless of the role performing the underlying mutation.
-- session_id / ip_address are intentionally left to their NULL defaults.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_write(
    p_table     text,
    p_record_id int,
    p_op        text,
    p_old       jsonb,
    p_new       jsonb,
    p_user_id   int,
    p_group_id  int,
    p_source    text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.audit_log (
        table_name, record_id, operation, old_data, new_data,
        user_id, group_id, action_source
    )
    VALUES (
        p_table, p_record_id, p_op, p_old, p_new,
        p_user_id, p_group_id, p_source
    );
$$;

-- ============================================================================
-- users — email / password_hash / username / name changes are security events.
-- INSERT (account created) and DELETE (account removed) are always recorded;
-- UPDATE is recorded only when one of the sensitive fields actually changed.
-- The password hash itself is never copied into the audit trail (it would
-- duplicate the credential into the export pipeline); a password rotation is
-- instead flagged with a synthetic `password_changed: true` marker.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_audit_users()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old jsonb;
    v_new jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_write('users', NEW.id, 'INSERT',
            NULL, to_jsonb(NEW) - 'password_hash',
            NEW.id, NULL, 'user');

    ELSIF TG_OP = 'UPDATE' THEN
        IF NOT (OLD.email         IS DISTINCT FROM NEW.email
             OR OLD.password_hash IS DISTINCT FROM NEW.password_hash
             OR OLD.username      IS DISTINCT FROM NEW.username
             OR OLD.first_name    IS DISTINCT FROM NEW.first_name
             OR OLD.last_name     IS DISTINCT FROM NEW.last_name) THEN
            RETURN NULL; -- nothing security-relevant changed
        END IF;

        v_old := to_jsonb(OLD) - 'password_hash';
        v_new := to_jsonb(NEW) - 'password_hash';
        IF OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
            v_new := v_new || '{"password_changed": true}'::jsonb;
        END IF;

        PERFORM audit_write('users', NEW.id, 'UPDATE',
            v_old, v_new, NEW.id, NULL, 'user');

    ELSE -- DELETE
        PERFORM audit_write('users', OLD.id, 'DELETE',
            to_jsonb(OLD) - 'password_hash', NULL,
            OLD.id, NULL, 'user');
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_users
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_audit_users();

-- ============================================================================
-- transactions — full audit trail on every INSERT / UPDATE / DELETE.
-- Plaid syncs drive high INSERT volume here by design. action_source is taken
-- from entry_method so "Plaid sync" and "user manual entry" are distinguishable.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_audit_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_source text := CASE
        WHEN COALESCE(NEW.entry_method, OLD.entry_method) = 'plaid' THEN 'plaid'
        ELSE 'user'
    END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_write('transactions', NEW.id, 'INSERT',
            NULL, to_jsonb(NEW), NEW.user_id, NULL, v_source);
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM audit_write('transactions', NEW.id, 'UPDATE',
            to_jsonb(OLD), to_jsonb(NEW), NEW.user_id, NULL, v_source);
    ELSE -- DELETE
        PERFORM audit_write('transactions', OLD.id, 'DELETE',
            to_jsonb(OLD), NULL, OLD.user_id, NULL, v_source);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_transactions
    AFTER INSERT OR UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_transactions();

-- ============================================================================
-- accounts — balance changes, deactivation (is_active) and Plaid re-links are
-- all sensitive. UPDATE is skipped when only `updated_at` moved (a no-op bump).
-- action_source = 'plaid' for Plaid-linked accounts, else 'user'.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_audit_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_source text := CASE
        WHEN COALESCE(NEW.plaid_account_id, OLD.plaid_account_id) IS NOT NULL THEN 'plaid'
        ELSE 'user'
    END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_write('accounts', NEW.id, 'INSERT',
            NULL, to_jsonb(NEW), NEW.user_id, NULL, v_source);
    ELSIF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(OLD) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updated_at') THEN
            RETURN NULL; -- only the updated_at bump changed
        END IF;
        PERFORM audit_write('accounts', NEW.id, 'UPDATE',
            to_jsonb(OLD), to_jsonb(NEW), NEW.user_id, NULL, v_source);
    ELSE -- DELETE
        PERFORM audit_write('accounts', OLD.id, 'DELETE',
            to_jsonb(OLD), NULL, OLD.user_id, NULL, v_source);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_accounts
    AFTER INSERT OR UPDATE OR DELETE ON accounts
    FOR EACH ROW EXECUTE FUNCTION fn_audit_accounts();

-- ============================================================================
-- account_members — controls who can access an account. Adding someone as a
-- joint owner or authorized_user on another user's account is high-sensitivity,
-- so the full before/after is captured on every INSERT / UPDATE / DELETE.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_audit_account_members()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_write('account_members', NEW.id, 'INSERT',
            NULL, to_jsonb(NEW), NEW.user_id, NULL, 'user');
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM audit_write('account_members', NEW.id, 'UPDATE',
            to_jsonb(OLD), to_jsonb(NEW), NEW.user_id, NULL, 'user');
    ELSE -- DELETE
        PERFORM audit_write('account_members', OLD.id, 'DELETE',
            to_jsonb(OLD), NULL, OLD.user_id, NULL, 'user');
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_account_members
    AFTER INSERT OR UPDATE OR DELETE ON account_members
    FOR EACH ROW EXECUTE FUNCTION fn_audit_account_members();

-- ============================================================================
-- group_memberships — joining / leaving / role changes directly change what a
-- user can see. group_id and user_id both come off the membership row.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_audit_group_memberships()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_write('group_memberships', NEW.id, 'INSERT',
            NULL, to_jsonb(NEW), NEW.user_id, NEW.group_id, 'user');
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM audit_write('group_memberships', NEW.id, 'UPDATE',
            to_jsonb(OLD), to_jsonb(NEW), NEW.user_id, NEW.group_id, 'user');
    ELSE -- DELETE
        PERFORM audit_write('group_memberships', OLD.id, 'DELETE',
            to_jsonb(OLD), NULL, OLD.user_id, OLD.group_id, 'user');
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_group_memberships
    AFTER INSERT OR UPDATE OR DELETE ON group_memberships
    FOR EACH ROW EXECUTE FUNCTION fn_audit_group_memberships();

-- ============================================================================
-- account_group_visibility — visibility policy changes. Setting visible_until
-- (a revoke) is the notable transition. No user column on this table, so
-- user_id is NULL; account_id lives in the captured row. group_id is recorded.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_audit_account_group_visibility()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_write('account_group_visibility', NEW.id, 'INSERT',
            NULL, to_jsonb(NEW), NULL, NEW.group_id, 'user');
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM audit_write('account_group_visibility', NEW.id, 'UPDATE',
            to_jsonb(OLD), to_jsonb(NEW), NULL, NEW.group_id, 'user');
    ELSE -- DELETE
        PERFORM audit_write('account_group_visibility', OLD.id, 'DELETE',
            to_jsonb(OLD), NULL, NULL, OLD.group_id, 'user');
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_account_group_visibility
    AFTER INSERT OR UPDATE OR DELETE ON account_group_visibility
    FOR EACH ROW EXECUTE FUNCTION fn_audit_account_group_visibility();

-- ============================================================================
-- invitations — status transitions (pending -> accepted / declined) and the
-- creation / removal of an invite are the meaningful access events. UPDATE is
-- recorded only when status or accepted_at changed. user_id = inviter.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_audit_invitations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_write('invitations', NEW.id, 'INSERT',
            NULL, to_jsonb(NEW), NEW.inviter_user_id, NEW.group_id, 'user');
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status      IS NOT DISTINCT FROM NEW.status
           AND OLD.accepted_at IS NOT DISTINCT FROM NEW.accepted_at THEN
            RETURN NULL; -- no status transition
        END IF;
        PERFORM audit_write('invitations', NEW.id, 'UPDATE',
            to_jsonb(OLD), to_jsonb(NEW), NEW.inviter_user_id, NEW.group_id, 'user');
    ELSE -- DELETE
        PERFORM audit_write('invitations', OLD.id, 'DELETE',
            to_jsonb(OLD), NULL, OLD.inviter_user_id, OLD.group_id, 'user');
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_invitations
    AFTER INSERT OR UPDATE OR DELETE ON invitations
    FOR EACH ROW EXECUTE FUNCTION fn_audit_invitations();

-- ============================================================================
-- plaid_items — record the link being added (INSERT) and removed (DELETE).
-- Cursor-only updates (the /transactions/sync checkpoint) are pure noise and
-- are skipped; any other column change (e.g. access-token rotation, institution
-- metadata) is recorded. The encrypted access-token columns and the sync cursor
-- are stripped from the snapshots so the credential never enters the audit
-- trail / export pipeline. action_source = 'plaid'.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_audit_plaid_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_secret_cols text[] := ARRAY[
        'access_token_ciphertext',
        'access_token_iv',
        'access_token_tag',
        'transactions_cursor'
    ];
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM audit_write('plaid_items', NEW.id, 'INSERT',
            NULL, to_jsonb(NEW) - v_secret_cols, NEW.user_id, NULL, 'plaid');
    ELSIF TG_OP = 'UPDATE' THEN
        -- Ignore updates that only advance the sync cursor / updated_at.
        IF (to_jsonb(OLD) - 'transactions_cursor' - 'updated_at')
           IS NOT DISTINCT FROM (to_jsonb(NEW) - 'transactions_cursor' - 'updated_at') THEN
            RETURN NULL;
        END IF;
        PERFORM audit_write('plaid_items', NEW.id, 'UPDATE',
            to_jsonb(OLD) - v_secret_cols, to_jsonb(NEW) - v_secret_cols,
            NEW.user_id, NULL, 'plaid');
    ELSE -- DELETE
        PERFORM audit_write('plaid_items', OLD.id, 'DELETE',
            to_jsonb(OLD) - v_secret_cols, NULL, OLD.user_id, NULL, 'plaid');
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_plaid_items
    AFTER INSERT OR UPDATE OR DELETE ON plaid_items
    FOR EACH ROW EXECUTE FUNCTION fn_audit_plaid_items();
