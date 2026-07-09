# Obsidian Financial

**Personal finance for households.** Link your real bank accounts, invite the
people you share money with, and get one live dashboard of your balances,
spending, subscriptions, and net worth — with you in control of exactly what is
shared and what stays private.

---

## What it does

Most finance apps are built for one person. Obsidian is built for a
**household**: partners, families, roommates — anyone who manages money
together but doesn't share *everything*.

- 🏦 **Link your banks** — connect checking, savings, credit cards, loans, and
  investment accounts through [Plaid](https://plaid.com). Balances and
  transactions sync automatically; no manual imports.
- 👨‍👩‍👧 **Build a household** — invite members by email. Everyone keeps their own
  login and their own accounts, but you see a combined picture of the money you
  choose to share.
- 🔒 **Private by default, shared by choice** — every account you link starts
  visible only to you. Share it with the household when you want it counted in
  the group view; make it private again anytime. Nobody sees an account you
  didn't share.
- 🤝 **Joint accounts** — add a household member as a co-owner of a shared
  account so it shows up as truly "ours," not just "mine."
- 📊 **One dashboard, many views** — flip between *Me*, the whole *Group*, or
  any individual member. Income vs. spending by month, spending by category,
  and a net-worth line that grows as your history does.
- 🔁 **Subscriptions & recurring bills** — automatically detected recurring
  charges, with average cost, next expected date, and your all-time spend on
  each one.
- ✍️ **Manual everything** — cash accounts, off-bank assets, or one-off
  transactions can be added and edited by hand, right alongside synced data.
- ⚡ **Live updates** — when a bank sync finishes, every open dashboard in the
  household refreshes itself in real time. No reload button.

## How it works

### 1. Sign up and get your own household

Registering creates your personal household automatically. You can use Obsidian
solo forever — the household features are there when you want them.

### 2. Link a bank (or add accounts manually)

Connecting a bank opens Plaid Link, the same secure widget used by major
finance apps. You log in **directly with your bank** — Obsidian never sees or
stores your banking credentials. Plaid hands back a scoped access token, which
is encrypted (AES-256-GCM) before it ever touches the database.

On link, Obsidian pulls your accounts, current balances, and up to ~24 months
of transaction history. After that, everything stays fresh automatically:
syncs run on a schedule (roughly every 7 hours per household), and you can
trigger one on demand from the dashboard.

### 3. Invite your household

Send an invite by email. When someone accepts, they join your household with
their accounts intact — but **nothing of theirs is shared automatically**.
Each member decides, account by account, what the household can see. Members
can leave (or be removed) at any time and walk away with all of their accounts
and history back in a personal household.

### 4. Read your money at a glance

The dashboard turns raw transactions into:

- **Monthly income vs. spending** — bar charts over 1 month to all-time ranges.
- **Spending by category** — where the money actually went, sliceable by
  timeframe.
- **Net worth over time** — assets minus liabilities, snapshotted daily per
  account, so the line reflects real history rather than estimates.
- **A full transaction feed** — searchable, filterable by category, income vs.
  spend, timeframe, and scoped to you, the group, or one member. Pending
  transactions are marked until they post.

Amounts follow the natural personal-finance convention: money in is positive,
money out is negative.

## Security & privacy

Money data deserves paranoia. Obsidian's posture:

- **No banking credentials stored — ever.** Bank login happens inside Plaid;
  Obsidian only receives a revocable access token, stored encrypted
  (AES-256-GCM, key kept outside the database).
- **Hardened sessions.** Passwords are hashed with argon2. Sessions use
  short-lived (15-minute) tokens in secure cookies with silent refresh, and
  idle sessions are revoked server-side after 30 minutes — the page logs itself
  out rather than sitting open and stale.
- **Changing your password kills every session**, everywhere, instantly.
- **Rate limiting** on login and registration blunts brute-force and
  credential-stuffing attempts, and blocked attempts are recorded.
- **A tamper-evident audit trail.** Every data change and auth event is
  captured in an append-only audit log and archived durably off-database.
- **Sharing is enforced in the database, not just the UI.** Row-level security
  and explicit visibility grants mean a household member can only ever query
  what was actually shared with the household.

## Under the hood

For the curious (full developer docs live in [`docs/`](docs/project-overview.md)):

| Layer | Tech |
|---|---|
| Frontend | React 19 · Vite · Tailwind 4 · Recharts |
| API | Node.js · Express 5 · TypeScript |
| Database | PostgreSQL (Supabase) — raw SQL, migration-managed schema |
| Bank data | Plaid (Link, transactions sync, balances, recurring streams) |
| Realtime | Server-Sent Events, fanned out across instances via Redis pub/sub |
| Background work | Dedicated scheduler worker (syncs, audit shipping, retention) |
| Audit archive | SQS → Lambda → S3 pipeline (LocalStack in development) |

The API tier is stateless and horizontally scalable: rate limits, caching, and
realtime events ride a shared Redis backplane, while anything
correctness-critical stays in Postgres. Redis and AWS are optional — a
single-node deployment runs with neither.

## Running it yourself

Prerequisites: Node 22+, Docker Desktop, the
[Supabase CLI](https://supabase.com/docs/guides/cli), and free
[Plaid sandbox](https://dashboard.plaid.com/signup) credentials.

```bash
git clone https://github.com/<you>/obsidian-financial.git
cd obsidian-financial
npm install

# configure secrets (DB URL, JWT secrets, Plaid sandbox keys, encryption key)
# — create .env.dev; see docs/environment.md for every variable

# option A: native
npx supabase start     # local Postgres + mail catcher
npm run server         # API on :3000
npm run dev            # frontend on :5173

# option B: full containerized stack (adds Redis, scheduler worker, LocalStack)
npm run dev:up
```

Open http://localhost:5173, register an account, and link a bank with Plaid's
sandbox credentials (`user_good` / `pass_good`).

Developer documentation — architecture, auth flow, database conventions,
testing, deployment, scaling — lives in [`docs/`](docs/project-overview.md).

## Status

Obsidian Financial is under active development. Expect rough edges, and don't
point it at production money without reading [`docs/deployment.md`](docs/deployment.md) first.
