-- Add 'loan' to the valid_account_type check constraint.
-- subtypeMap.ts already maps Plaid loan accounts to 'loan', but the
-- original constraint only covered the 4 dashboard buckets. Postgres
-- requires dropping and re-adding the constraint to change its definition.

ALTER TABLE accounts
    DROP CONSTRAINT valid_account_type;

ALTER TABLE accounts
    ADD CONSTRAINT valid_account_type
        CHECK (account_type IN ('checking', 'savings', 'credit', 'investment', 'loan'));
