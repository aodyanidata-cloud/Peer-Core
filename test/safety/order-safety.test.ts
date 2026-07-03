import { describe, it } from 'vitest';

/**
 * ORDER / MONEY SAFETY SUITE (🔴) — harness only at Stage A1.
 * Real assertions land in R2 (ordering + payment). R1 has no money surface.
 */
describe('order & money safety', () => {
  it.todo('order totals are computed server-side; client-supplied totals are ignored');
  it.todo('a duplicate submit with the same idempotency key creates exactly one order');
  it.todo('only legal order-state transitions are permitted');
  it.todo('payment is authorized before an order is created; auth failure creates no order');
  it.todo('the agent can never set prices, apply discounts, or waive fees unbidden');
});
