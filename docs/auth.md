# Auth Flow

Cookie-based JWTs, not Authorization headers.

## Tokens

- **Access token**: 15-min HS256 JWT, `req.cookies.access_token` (with optional
  `Bearer ` prefix). Payload is `{ userId, groupId, role }` — `groupId`/`role`
  come from the user's active `group_memberships` row.
- **Refresh token**: 7-day JWT, `req.cookies.refreshToken`. Stored server-side as
  a SHA-256 hash in `refresh_tokens` (see `utils/hashing.ts`,
  `repository/refreshTokenRepository.ts`), with a `last_used_at` column tracking
  activity.
- The verification calls pin the expected algorithm (HS256) so a future move away
  from a symmetric key can't open an algorithm-confusion hole.

## Silent refresh (in `authenticate` middleware)

On `TokenExpiredError` for the access token, `authenticate` pulls the refresh
cookie, calls `refreshTokens()`, sets a new access-token cookie, and continues.

**Silent refresh does not rotate the refresh token.** Rotating on every refresh
raced concurrent requests carrying the same expired-access cookie (the first
revoked the token out from under the second, forcing a re-login). Instead the same
refresh token is kept; `touchRefreshToken` bumps `last_used_at` and slides the
7-day expiry, so an actively-used session survives. The refresh token **is** still
rotated at login/logout/password-change.

## Activity tracking & inactivity limit

**Activity is bumped on every authenticated request, not just on silent refresh.**
Even when the access token is still valid, `authenticate` calls
`recordRefreshTokenActivity()` (best-effort — it swallows errors so an
activity-write failure can't 500 an otherwise-valid request), which slides
`last_used_at` and the expiry. So `last_used_at` reflects real request activity,
and the 30-min inactivity limit in `refreshService.ts` (`INACTIVITY_LIMIT_MS`) is
measured from the last *request*. If exceeded on the next refresh, **all** of the
user's refresh tokens are revoked.

**Client-side idle auto-logout** mirrors this so a dead session doesn't strand a
logged-in-looking page — see [frontend-architecture.md](frontend-architecture.md).
The client constant must stay in sync with the server's `INACTIVITY_LIMIT_MS`.

## Hashing & secrets

- Passwords: **argon2**.
- Tokens (refresh + invitation + password-reset): SHA-256 before storage.
- Required env vars (`utils/jwt.ts` throws on import if missing):
  `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.

## Related protections

- A DB trigger revokes all refresh tokens on password change
  (`20260423110202_revoke_sessions_on_password_change.sql`).
- Login/register/password-reset sit behind the IP-keyed `authRateLimit`
  ([rate-limiting.md](rate-limiting.md)); blocked attempts are recorded as
  `RATE_LIMITED` auth audit events ([audit-pipeline.md](audit-pipeline.md)).
- Stale `groupId` in a kicked user's access token self-corrects on the next silent
  refresh — `refreshService.ts` re-queries `findActiveMembership`
  ([group-lifecycle.md](group-lifecycle.md)).
