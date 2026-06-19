-- Joint accounts revamp: let the user flag, during the linking session, that an
-- account is jointly owned. This surfaces the "invite / link a co-owner" actions
-- in the UI. It is purely a user assertion (no Plaid Identity), so it is a simple
-- boolean defaulting to false. Public/private visibility is NOT stored here — it
-- stays derived from account_group_visibility (a row present = public/visible to
-- the household, absent = private).

ALTER TABLE accounts
    ADD COLUMN is_joint_declared BOOLEAN NOT NULL DEFAULT false;
