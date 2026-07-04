# Peers — Restaurants vertical

The first vertical on the Peers agent-marketplace engine. Multi-tenant, agent-native,
merchant-empowerment (flat subscription, no commission). This repo is the **modular monolith**
that engine + Restaurants vertical are built in.

**MVP = R1** (reservations + info, **no payment**). Build order: **Stage A → Stage B (engine core)
→ Stage C-R1**. See `CLAUDE.md` for the binding engineering rules.

## Stack
TypeScript strict · NestJS (Fastify) · PostgreSQL + Drizzle · REST under `/api/v1`.

## Getting started
### Prerequisites
- **Node.js ≥ 22**
- **PostgreSQL 16** running locally

### 1. Create the database + a non-superuser role
Row-level security is FORCEd, and a Postgres **superuser bypasses RLS** — so the app connects
as a normal role, not `postgres`:
```sh
sudo -u postgres psql <<'SQL'
CREATE ROLE app_user LOGIN PASSWORD 'app_pass';
CREATE DATABASE peers_restaurants OWNER app_user;
SQL
```

### 2. Configure and run
```sh
npm install
cp .env.example .env         # DATABASE_URL is loaded automatically at startup
npm run db:migrate           # create the tables
npm run seed                 # optional: a demo restaurant + menu + a few orders
npm run start:dev            # boots on :$PORT (dev, auto-reload)
```
Then open:
- `GET /api/v1/health` → `{"status":"ok"}`
- Diner menu widget → `/api/v1/r/demo-grill/widget` (after seeding)
- Staff console → `/api/v1/staff/console`

Other commands:
```sh
npm run typecheck            # tsc, zero errors
npm run build && npm start   # production-style run
npm test                     # vitest: unit + e2e + safety-suite harness
npm run fitness              # mechanical architecture guards
```
The `.env` file is loaded by the app and the `db:migrate`/`seed` scripts via Node's built-in
env-file support; real environment variables take precedence over it.

**WSL note:** run everything (Node *and* Postgres) inside WSL, or everything on Windows — don't
split them, or `localhost` and environment variables won't line up across the boundary. In WSL,
start Postgres each session with `sudo service postgresql start`.

## Layout
```
src/
  main.ts                 Fastify bootstrap, /api/v1 prefix
  app.module.ts           root module — wires health + the eight engine modules
  health/                 GET /api/v1/health
  db/                     Drizzle connection (schema intentionally empty until B1 🔴)
  modules/                engine-core boundaries (scaffold only):
    identity  tenancy  catalog  agent
    inference-gateway  tool-dispatcher  channels  notifications
test/
  health.test.ts          health e2e
  safety/                 🔴 safety suites (tenant-isolation, auth, order-safety) — harness now,
                          real assertions land with B1/B2/R2
scripts/
  fitness/                mechanical architecture checks run in CI
  migrate.ts  seed.ts     DB harness (no-ops until there is a schema)
skills/                   dangerous-code, adapter — agent operating references
.github/workflows/ci.yml  typecheck · lint · build · fitness · tests
```

## Risk tiers
🔴 dangerous (money / tenant isolation / auth / state machine) — **human-gated, never
auto-merged** · 🟡 complex · 🟢 standard. See `CLAUDE.md`.
