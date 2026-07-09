# Group Lifecycle

Every user always belongs to **exactly one active group** (household). The
lifecycle rules:

- **Registration** — `registrationService.ts` calls `createPersonalGroupForUser`
  immediately after creating the user row. The resulting group
  (`"<first_name>'s Household"`, `role='creator'`) is written into the access
  token JWT so the user has a valid `groupId` from the very first request.
- **Invite accept** — `acceptInvitationAndJoinGroup` (in
  `invitationRepository.ts`) runs in one transaction: locks the accepter's
  membership row, verifies their current group has only them as a member and they
  are the `creator`, soft-departs the membership, hard-deletes the auto-group
  (CASCADE cleans up `account_group_visibility`), and inserts a new
  `group_memberships` row in the inviter's group. The accepter's accounts survive
  (they remain in `account_members`) but are **not** automatically shared into
  the new household — visibility must be explicitly granted
  ([account-visibility.md](account-visibility.md)).
- **Leave / Kick / Group delete** — all three paths call
  `unlinkUserAccountsFromGroup` to remove the departing user's accounts from the
  household's visibility, then call `createPersonalGroupForUser` to restore solo
  state. `createPersonalGroupForUser` creates the group + membership and
  re-inserts `account_group_visibility` rows for every account the user owns, so
  their accounts are immediately visible in their restored personal group.
- **Stale JWTs after kick** — a kicked user's access token is valid for up to
  15 min with a stale `groupId`. This self-corrects on the next silent refresh
  because `refreshService.ts` re-queries `findActiveMembership`
  ([auth.md](auth.md)).

`createPersonalGroupForUser` in `groupRepository.ts` is the **single source of
truth for the solo state** — call it wherever solo state needs to be restored;
don't duplicate the group+membership+visibility logic inline.

## Invitations

- `POST /api/v1/invitations` (creator sends, by email) →
  `GET /invitations/preview?token=…` (masked preview for the invitee) →
  `POST /invitations/accept` or `/decline`. Tokens are SHA-256 hashed at rest and
  expire. The frontend flow lives in `src/pages/AcceptInvitation.tsx`.
