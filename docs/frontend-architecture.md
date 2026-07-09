# Frontend Architecture

React 19 + Vite + Tailwind 4 SPA in `src/`, compiled with `tsconfig.app.json`.
`main.tsx` mounts `App.tsx`. In dev, Vite proxies `/api` to the backend
(`vite.config.ts`; target overridable via `VITE_PROXY_TARGET` for the
containerized stack), so all API calls are same-origin and the auth cookies flow
automatically.

## Routing — `src/lib/router.tsx`

A deliberate ~50-line custom router (no react-router): a `Router` context holding
`{ path, search, navigate }` over `history.pushState`/`popstate`, plus
`useRouter()` and `useQueryParam(name)`. `App.tsx` switches on `path`:

| Path | Page | Guard |
|---|---|---|
| `/` | `Landing` (also the fallback) | public |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | auth pages | public |
| `/invitations` | `AcceptInvitation` (token via query param) | public |
| `/onboarding` | `Onboarding` | `ProtectedRoute` |
| `/dashboard` | `Dashboard` | `ProtectedRoute` |

## Session handling — `ProtectedRoute` + `src/lib/api.ts`

Auth is cookie-based, so the client never touches tokens. The pieces:

- `api.getSession()` is called once on mount to confirm the session (401 →
  redirect to `/login?returnTo=…`).
- **Client-side idle auto-logout.** "Activity" is purely a successful
  authenticated HTTP request — there's no DOM/heartbeat tracking, and the
  dashboard doesn't poll. The API layer fires `onActivity` on every successful
  request (registered via `setSessionListeners` by `ProtectedRoute`), which resets
  a timer; after `INACTIVITY_LIMIT_MS` idle the client proactively logs out
  (revoking server-side) and redirects, instead of stranding a logged-in-looking
  page whose session already died server-side. Any `401` fires
  `onSessionExpired` → redirect. **The client `INACTIVITY_LIMIT_MS` constant must
  stay in sync with the server's** in `node/src/services/auth/refreshService.ts`
  (both 30 min).

## API client — `src/lib/api.ts`

One typed `request<T>()` wrapper over `fetch` (`credentials: "include"`, JSON,
throws a typed `ApiError` carrying `status`/`errorCode`/`details`), and an `api`
object with one method per endpoint. All response shapes are typed here
(`DashboardSummary`, `TransactionPageResult`, `RecurringStream`, …) — this file is
the de-facto client-side contract for the backend API.

### Live refresh over SSE

`subscribeToSync(onSync)` opens an `EventSource` on `/api/v1/events` and invokes
the callback on each `sync:complete` event (auto-reconnects; returns an
unsubscribe function for unmount). `Dashboard` uses it to refetch the summary when
the household's Plaid sync finishes — cron or on-demand, triggered by any member.
Server side: [realtime-sse.md](realtime-sse.md).

## Pages — `src/pages/`

`Landing`, `Login`, `Register`, `ForgotPassword`, `ResetPassword`,
`AcceptInvitation` (invite preview/accept/decline), `Onboarding` (post-register:
link a bank or add a manual account), `Dashboard` (the app shell).

## Dashboard feature — `src/features/dashboard/`

`pages/Dashboard.tsx` owns the top-level state: active tab
(`dashboard`/`transactions`/`accounts`), active **view** (`me`, `group`, or
`member-{id}`), time range (`1M`…`ALL`), the fetched `DashboardSummary`, and the
open modal. Everything below it is presentational or derives data:

- `data.ts` — pure derivation layer: turns the raw `DashboardSummary` into
  view-scoped display models (`buildDashboardView`, `buildAccountsForView`,
  `buildGroupViews`, `sliceMonths`, `sliceCategories`). No fetching.
- `tabs.tsx` — the three tab bodies (`DashboardTab`, `TabTransactions`,
  `TabAccounts`), including the paged/filtered transaction list backed by
  `/dashboard/transactions` and the accounts management UI.
- `charts.tsx` — Recharts wrappers (income/spending bars, category pie, net-worth
  line).
- `modals.tsx` — `InviteModal`, `SettingsModal` (profile, household rename,
  member management, account deletion/ownership transfer).
- `AddAccountModal.tsx` — Plaid Link (via `react-plaid-link`: mint link token →
  open Link → exchange public token) plus the manual-account form.
- `AddTransactionModal.tsx` — manual transaction entry/edit.
- `accountTaxonomy.ts` / `transactionTaxonomy.ts` — display names, ordering, and
  color tones for Plaid's account types and transaction categories.

### Conventions

- Amount sign follows the DB convention: positive = inflow, negative = outflow
  (see [database.md](database.md)). Manual entry uses the natural
  personal-finance sign.
- Group views only ever contain accounts/transactions shared with the household;
  private accounts show a "Private" tag only in personal views.

## Components & styles

- `src/components/` — small shared UI: brand marks (`ObsidianMark`, `Wordmark`,
  `AuthBrand`), form primitives (`Field`, `PasswordInput`), `icons.tsx` (inline
  SVG icon set).
- `src/styles/` — plain CSS files per surface (`design.css` is the base design
  system; `dashboard.css`, `landing.css`, `onboarding.css`, `auth-extra.css`, …)
  loaded alongside Tailwind 4 (Vite plugin, no tailwind.config).
- Theme is forced light for now (`data-theme="light"` set in `App.tsx`).

## Build

`npm run build` = `tsc -b && vite build` → static assets in `dist/`. The frontend
is **not** part of the backend Docker image; it deploys separately (see
[deployment.md](deployment.md)).
