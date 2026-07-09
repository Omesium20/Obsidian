# Commands

```bash
npm run dev          # Vite dev server (frontend, native)
npm run server       # Backend with nodemon + tsx (hot reload, runs node/src/server.ts)
npm run build        # tsc -b && vite build (frontend production build)
npm run build:server # Compile backend to node/dist/
npm run lint         # ESLint over the repo
npm test             # Vitest (single run, integration tests against local Postgres)
npm run preview      # Preview the production frontend build

# Containerized dev stack (backend + scheduler worker + frontend + Redis + LocalStack)
npm run dev:up       # supabase start + docker compose dev up --build
npm run dev:down     # docker compose dev down + supabase stop
npm run dev:clear    # dev:down but also drops the named node_modules volumes (-v)
npm run test:docker  # Run vitest inside the test container against .env.test
```

> `npm run dev:clear` matters after adding an npm dependency while using the
> containerized stack: the named `*_node_modules` volumes shadow the image's fresh
> install, so a new dep is `MODULE_NOT_FOUND` until the volumes are recreated.

There is no npm script for the scheduler worker natively; it runs as the `scheduler`
compose service. To run it natively: `npx tsx node/src/worker.ts` (needs the same
env as the backend, plus `WORKER_ROLE=scheduler` if Redis is on — see
[redis.md](redis.md)).

## Running tests selectively

Run a single test file:

```bash
npx vitest run node/src/tests/repository/userRepository.test.ts
```

The test runner is configured with named projects in `vitest.config.ts` — run one with:

```bash
npx vitest run --project users
```

Projects: `users`, `accounts`, `groups`, `transactions`, `refreshTokens`,
`plaidSync`, `accountTransactions`, `userService`, `refreshService`,
`balanceSnapshots`, `dashboard`, `accountCoownership`, `auditShipment`,
`authEvents`, `auditShipper`.

Each project maps to exactly one test file via its `include` glob, so **a new test
file needs a new project entry** in `vitest.config.ts` to be picked up. See
[testing.md](testing.md).
