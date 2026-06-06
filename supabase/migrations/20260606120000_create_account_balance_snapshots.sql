-- Per-account balance snapshots, the source for the net-worth-over-time chart.
-- One row per account per day (the 30-min sync upserts the same day's row in
-- place); net worth is summed across accounts at read time using the sign
-- convention assets − liabilities (credit/loan count negative).

CREATE TABLE account_balance_snapshots (
    id            SERIAL PRIMARY KEY,
    account_id    INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    balance       DECIMAL(12,2) NOT NULL,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    captured_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, snapshot_date)
);

CREATE INDEX idx_abs_account_date
    ON account_balance_snapshots (account_id, snapshot_date DESC);

-- Match the blanket RLS posture of sibling tables; the node server connects as
-- the table owner and bypasses RLS (see 20251223001447_blanket_RLS.sql).
ALTER TABLE account_balance_snapshots ENABLE ROW LEVEL SECURITY;
