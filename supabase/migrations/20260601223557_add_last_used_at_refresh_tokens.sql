-- Track per-token activity so the 30-minute inactivity limit can be enforced
-- without rotating the refresh token on every silent access-token refresh.
-- Rotation was removed to fix a race where two concurrent requests presenting
-- the same refresh token would revoke it out from under each other (one request
-- succeeding, the other 401-ing and forcing a re-login). Inactivity now keys off
-- last_used_at, which the refresh path bumps on each use.
ALTER TABLE refresh_tokens
    ADD COLUMN last_used_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows so the inactivity check has a sane baseline.
UPDATE refresh_tokens
SET last_used_at = COALESCE(created_at, NOW())
WHERE last_used_at IS NULL;
