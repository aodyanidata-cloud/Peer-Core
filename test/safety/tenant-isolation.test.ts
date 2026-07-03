import { describe, it } from 'vitest';

/**
 * TENANT-ISOLATION SAFETY SUITE (🔴) — harness only at Stage A1.
 *
 * Real assertions land with task B1 (Multi-tenancy + RLS). This file is the
 * mandatory CI hook so the suite exists from day one; the cases below are the
 * contract B1 must satisfy. They are `.todo` so CI is green now but the intent
 * is recorded and impossible to forget.
 */
describe('tenant isolation (RLS)', () => {
  it.todo('a query under tenant A never returns tenant B rows (concurrent cross-fire)');
  it.todo('RLS is FORCEd — even the table owner cannot bypass it');
  it.todo('a client-supplied tenant_id is ignored; tenant context is server-derived');
  it.todo('missing tenant context fails closed (no rows), never open (all rows)');
  it.todo('vector/embedding search is namespaced per tenant');
});
