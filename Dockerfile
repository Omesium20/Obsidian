# syntax=docker/dockerfile:1
# ============================================================================
# Single multi-stage image for the whole stack.
#
#   target: dev    -> hot-reload image shared by the backend, scheduler,
#                     frontend, and test services. Source is bind-mounted by
#                     docker-compose.dev.yaml, so this stage only pre-installs
#                     dependencies; each compose service supplies its own
#                     `command:` (server.ts / worker.ts / vite / vitest).
#
#   default (prod) -> compiles ONLY the backend and runs the built server.
#                     Used by docker-compose.prod.yaml (`build: .`).
# ============================================================================

# ---- deps: shared dependency install (all deps, incl. dev tooling) ----------
FROM node:22-slim AS deps
WORKDIR /usr/local/app
# All deps including devDeps — the dev stage needs tsx/nodemon/vite at runtime
# and the build stage needs typescript to compile. `npm ci` installs the exact
# package-lock versions for a reproducible build (a loose `npm install` can drift
# transitive versions and surface type mismatches the locked tree doesn't have).
COPY package*.json ./
RUN npm ci

# ---- dev: hot-reload runtime (backend / scheduler / frontend / test) --------
# No source COPY: docker-compose.dev.yaml bind-mounts ./node, ./src, etc. over
# this layer and a named volume preserves node_modules. The default CMD runs the
# backend so the stage is usable on its own; compose overrides `command:` for the
# scheduler (worker.ts), frontend (vite), and test (vitest) services.
FROM deps AS dev
EXPOSE 3000 3005 5173
# nodemon supervises tsx and respawns on .ts changes. --legacy-watch enables
# polling, required for reliable file events through bind mounts on Windows/WSL2.
CMD ["npx", "nodemon", \
     "--watch", "node/src", \
     "--ext", "ts,js,json", \
     "--legacy-watch", \
     "--exec", "tsx", "node/src/server.ts"]

# ---- build: compile the backend to node/dist -------------------------------
FROM deps AS build
COPY . .
RUN npm run build:server

# ---- prod: backend-only runtime (default target) ---------------------------
FROM node:22-slim AS prod
WORKDIR /usr/local/app
ENV NODE_ENV=production
# Prod runtime needs only production deps — the compiled JS has no tsx/tsc.
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /usr/local/app/node/dist ./build
EXPOSE 3000
# tsconfig.server.json has rootDir ./node, so node/src/server.ts compiles to
# node/dist/src/server.js -> build/src/server.js here.
CMD ["node", "build/src/server.js"]
