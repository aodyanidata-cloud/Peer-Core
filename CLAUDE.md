# Peers — Restaurants vertical

Multi-tenant agent-marketplace engine, restaurant-shaped. First vertical. MVP = **R1**
(reservations + info, **no payment**). Build order: **Stage A → Stage B (engine core) → Stage C-R1**.

## Stack
TypeScript **strict** · NestJS (Fastify) · PostgreSQL + Drizzle · REST under `/api/v1`
· one language end to end · money as integer minor units (never floats).

## Commands
- `npm run typecheck` — tsc, zero errors required
- `npm run build` — nest build
- `npm test` — vitest (unit + e2e + safety harness)
- `npm run test:safety` — the 🔴 safety suites
- `npm run lint` — eslint
- `npm run fitness` — mechanical architecture checks (see `scripts/fitness/`)

## The line (binding — do NOT cross)
Risk tiers tag every change: 🔴 dangerous · 🟡 complex · 🟢 standard.
**Anything touching money, tenant isolation, auth, or a state machine is 🔴 and is human-gated.**
It never merges on an agent's own approval. If a task pulls you toward 🔴 work you were not
explicitly assigned, STOP and escalate.

## DON'T (non-negotiables)
1. **DON'T** trust a client-supplied `tenant_id`. Tenant context is derived server-side and set
   per-transaction (`set_config('app.current_tenant', …, true)`). RLS is `ENABLE`d **and** `FORCE`d
   on every tenant table.
2. **DON'T** let the model have authority. The model *proposes*; the **tool-dispatcher** authorizes
   and executes. Scoped, idempotent, audited.
3. **DON'T** call an LLM SDK directly. All inference goes through the **inference-gateway** seam.
4. **DON'T** move money outside the escrow/payment rail. Payment success is set only by a verified
   webhook. Every money/state POST carries an idempotency key. (R2+.)
5. **DON'T** invent menu items, prices, availability, or allergen info. Order math uses structured
   prices only; retrieved menu *text* is untrusted for pricing. A diner-stated price is ignored.
6. **DON'T** shape the engine around restaurants. Core modules stay generic and vertical-neutral;
   restaurant logic lives in the vertical layer. Keep the catalog/order model **PosProvider-compatible**.
7. **DON'T** commit secrets. `.env` is gitignored; use `.env.example` for shape only.
8. **DON'T** skip the state machine. Only legal transitions; illegal ones are rejected, not coerced.

## Conventions
- One module = one boundary under `src/modules/`. No cross-module reach-around; talk via providers.
- New tenant-scoped table ⇒ its RLS policy ships in the same change (never a table without its policy).
- Every 🔴 change ships with its adversarial test in the matching `test/safety/` suite.
- Integrations use **contract → adapter → registry**; core never imports a vendor SDK.

## Working style
Every correction becomes a new line here. Keep this file lean; reference specs (BRD, feature specs)
rather than pasting them.
