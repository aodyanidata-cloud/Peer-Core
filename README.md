# Peers — Restaurants vertical

The first vertical on the Peers agent-marketplace engine. Multi-tenant, agent-native,
merchant-empowerment (flat subscription, no commission). This repo is the **modular monolith**
that engine + Restaurants vertical are built in.

**MVP = R1** (reservations + info, **no payment**). Build order: **Stage A → Stage B (engine core)
→ Stage C-R1**. See `CLAUDE.md` for the binding engineering rules.

## Stack
TypeScript strict · NestJS (Fastify) · PostgreSQL + Drizzle · REST under `/api/v1`.

## Getting started
```sh
npm install
cp .env.example .env        # fill in DATABASE_URL, PORT
npm run typecheck           # tsc, zero errors
npm run build               # nest build
npm start                   # boots on :$PORT — GET /api/v1/health -> {"status":"ok"}
npm test                    # vitest: health e2e + safety-suite harness
npm run fitness             # mechanical architecture guards
```
A database is only needed once tenant-scoped work lands (B1); the app boots and the health
check passes without one.

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
