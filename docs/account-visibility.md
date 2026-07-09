# Account Visibility & Co-ownership

`account_group_visibility` controls which accounts a group can see on the
dashboard. A visibility row = "this account is shared with (public in) this
group"; no row = private to its holders.

## Rules

- Linking a bank via Plaid writes visibility rows only for the user's **own
  current group** (their personal household at link time).
- Joining a new household via invite does **not** auto-share the joining user's
  accounts — the CASCADE delete of their old auto-group removes the old
  visibility rows, and no new ones are inserted for the new group
  ([group-lifecycle.md](group-lifecycle.md)).
- Group views (dashboard aggregates, group transaction feeds) only ever include
  shared accounts; a private account shows a "Private" tag in its holders'
  personal views only.

## Changing visibility

`PUT /api/v1/accounts/:id/visibility` with `{ visibility: "group" | "private" }` →
`accountService.setAccountVisibility`, which calls
`accountRepository.shareAccountWithGroup` / `unshareAccountFromGroup`. Only an
`owner` or `joint` `account_members` row grants permission to change visibility.
The route invalidates the group's cached dashboard summaries
([caching.md](caching.md)).

## Co-ownership (`account_members`)

`ownership_type` is `owner`, `joint`, or `authorized_user`; joint co-owners get
the same visibility rights as the owner.

- `GET /api/v1/accounts/:id/members` — list holders.
- `POST /api/v1/accounts/:id/members` — add a household member as a joint
  co-owner.
- `DELETE /api/v1/accounts/:id/members/:userId` — remove a co-owner.
- `PUT /api/v1/accounts/:id/joint` — toggle the user-declared
  `accounts.is_joint_declared` display flag (does not grant access by itself).

## Account deletion & ownership transfer

`DELETE /api/v1/accounts/:id`: with no co-owners it's a soft delete (history
kept; Plaid sync stops). With joint co-owners it **transfers ownership** instead —
automatically to a sole co-owner, or to `new_owner_user_id` when there are
several (a 422 with `details.candidates` prompts the picker in the UI).
