-- Align accounts with Plaid's native account taxonomy.
-- Previously account_type held a lossy 5-bucket rollup (checking/savings/credit/
-- investment/loan) and plaid_type/plaid_subtype held the raw Plaid values. We now
-- store Plaid's taxonomy directly: `type` = one of the 4 Plaid top-level types,
-- `subtype` = Plaid's subtype verbatim. That makes plaid_type/plaid_subtype exact
-- duplicates, so they are dropped.
--
-- subtype is intentionally free-form (no CHECK): Plaid adds new subtypes over time
-- and a hardcoded list would reject otherwise-valid accounts. Subtype validation
-- lives in app code (subtypeMap.ts / accountSchemas.ts).

ALTER TABLE accounts RENAME COLUMN account_type TO type;
ALTER TABLE accounts ADD COLUMN subtype VARCHAR(50);

-- Drop the old 5-bucket rollup constraint before rewriting the column's meaning.
ALTER TABLE accounts DROP CONSTRAINT valid_account_type;

-- Backfill subtype FIRST, while `type` still holds the old rollup value. Prefer the
-- raw Plaid subtype when present; otherwise derive a representative subtype.
UPDATE accounts SET subtype = COALESCE(plaid_subtype, CASE type
    WHEN 'checking'   THEN 'checking'
    WHEN 'savings'    THEN 'savings'
    WHEN 'credit'     THEN 'credit card'
    WHEN 'investment' THEN 'brokerage'
    ELSE NULL END);

-- Now transform `type` to Plaid's top-level types. Prefer the raw Plaid type; else
-- collapse checking/savings into 'depository' (credit/investment/loan already match
-- Plaid's type names).
UPDATE accounts SET type = COALESCE(plaid_type, CASE type
    WHEN 'checking' THEN 'depository'
    WHEN 'savings'  THEN 'depository'
    ELSE type END);

-- Drop the now-redundant raw columns (idx_accounts_plaid_type drops with the column).
ALTER TABLE accounts DROP COLUMN plaid_type;
ALTER TABLE accounts DROP COLUMN plaid_subtype;

-- Enforce the 4 Plaid top-level types. type stays nullable (manual accounts may omit).
ALTER TABLE accounts
    ADD CONSTRAINT valid_account_type
        CHECK (type IN ('depository', 'credit', 'loan', 'investment'));
