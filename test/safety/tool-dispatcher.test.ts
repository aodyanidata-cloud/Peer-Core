import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { applyMigrations } from '../../src/db/migrate';
import { ToolRegistry } from '../../src/modules/tool-dispatcher/registry';
import { ToolDispatcher } from '../../src/modules/tool-dispatcher/tool-dispatcher.service';
import { DispatchError } from '../../src/modules/tool-dispatcher/types';
import type { AuthContext } from '../../src/modules/identity/auth.types';
import { withTenant } from '../../src/modules/tenancy/tenant-context';

/**
 * TOOL-DISPATCHER SAFETY SUITE (🔴 B4). Real tests against Postgres.
 */
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('tool dispatcher (authority boundary)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let registry: ToolRegistry;
  let dispatcher: ToolDispatcher;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userId = randomUUID();

  // ctx = a user who is 'staff' in A and has NO membership in B.
  const ctx: AuthContext = {
    userId,
    phone: '+966500000001',
    isPlatformAdmin: false,
    memberships: [{ tenantId: tenantA, role: 'staff' }],
  };

  let sideEffects = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE tool_invocations, catalog_items, users, tenants RESTART IDENTITY CASCADE',
    );
    await db.insert(schema.tenants).values([
      { id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' },
      { id: tenantB, slug: 'b-' + tenantB.slice(0, 8), name: 'B' },
    ]);
    await db.insert(schema.users).values({ id: userId, phone: ctx.phone });

    sideEffects = 0;
    registry = new ToolRegistry();
    // A read tool any member may run.
    registry.register({
      name: 'ping',
      sideEffect: 'read',
      handler: async () => {
        sideEffects += 1;
        return { pong: true };
      },
    });
    // A write tool: creates a catalog item using the SERVER tenant context,
    // deliberately ignoring any tenantId in args.
    registry.register({
      name: 'create_item',
      sideEffect: 'write',
      handler: async (args, tc) => {
        sideEffects += 1;
        const [row] = await tc.tx
          .insert(schema.catalogItems)
          .values({
            tenantId: tc.tenantId, // server context, NOT args
            name: String(args.name ?? 'x'),
            priceMinor: 100,
          })
          .returning({ id: schema.catalogItems.id, tenantId: schema.catalogItems.tenantId });
        return row;
      },
    });
    // An owner-only, confirmation-required tool.
    registry.register({
      name: 'delete_everything',
      sideEffect: 'write',
      requiredRoles: ['owner'],
      requiresConfirmation: true,
      handler: async () => {
        sideEffects += 1;
        return { done: true };
      },
    });

    dispatcher = new ToolDispatcher(registry, db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('an unknown tool is rejected and never runs', async () => {
    await expect(
      dispatcher.dispatch(ctx, tenantA, 'no_such_tool'),
    ).rejects.toMatchObject({ code: 'unknown_tool' });
    expect(sideEffects).toBe(0);
  });

  it('a tool in a tenant the actor has no membership for is rejected', async () => {
    await expect(
      dispatcher.dispatch(ctx, tenantB, 'ping'),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(sideEffects).toBe(0);
  });

  it('a role-gated tool is rejected when the actor lacks the role', async () => {
    // ctx is 'staff'; delete_everything requires 'owner'.
    await expect(
      dispatcher.dispatch(ctx, tenantA, 'delete_everything', {}, { confirmed: true }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(sideEffects).toBe(0);
  });

  it('a confirmation-required tool is rejected without explicit confirmation', async () => {
    const owner: AuthContext = {
      ...ctx,
      memberships: [{ tenantId: tenantA, role: 'owner' }],
    };
    await expect(
      dispatcher.dispatch(owner, tenantA, 'delete_everything'),
    ).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(sideEffects).toBe(0);

    const res = await dispatcher.dispatch(
      owner,
      tenantA,
      'delete_everything',
      {},
      { confirmed: true },
    );
    expect(res).toEqual({ done: true });
    expect(sideEffects).toBe(1);
  });

  it('is idempotent: same key runs once, second call returns the cached result', async () => {
    const key = 'idem-1';
    const first = await dispatcher.dispatch(
      ctx,
      tenantA,
      'create_item',
      { name: 'Widget' },
      { idempotencyKey: key },
    );
    const second = await dispatcher.dispatch(
      ctx,
      tenantA,
      'create_item',
      { name: 'Widget' },
      { idempotencyKey: key },
    );
    expect(second).toEqual(first);
    expect(sideEffects).toBe(1); // executed exactly once

    // Read inside tenant A's context (RLS hides rows from a context-less read).
    const items = await withTenant(db, tenantA, (tx) =>
      tx.select().from(schema.catalogItems),
    );
    expect(items).toHaveLength(1);
  });

  it('records an audit row (tenant, tool, actor) for every dispatch', async () => {
    await dispatcher.dispatch(ctx, tenantA, 'ping');
    const rows = await withTenant(db, tenantA, (tx) =>
      tx.select().from(schema.toolInvocations),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: tenantA,
      tool: 'ping',
      actorUserId: userId,
      status: 'completed',
    });
  });

  it('model-supplied args cannot escalate the tenant: effect lands in the authorized tenant only', async () => {
    // Dispatch for tenantA, but args try to smuggle tenantB.
    const row = (await dispatcher.dispatch(
      ctx,
      tenantA,
      'create_item',
      { name: 'Sneaky', tenantId: tenantB },
    )) as { tenantId: string };
    expect(row.tenantId).toBe(tenantA);

    // Tenant B, read in its own context, sees nothing.
    const bItems = await withTenant(db, tenantB, (tx) =>
      tx.select().from(schema.catalogItems),
    );
    expect(bItems).toHaveLength(0);
  });

  it('a rejected dispatch is a plain DispatchError (not a leak of internals)', async () => {
    await expect(dispatcher.dispatch(ctx, tenantB, 'ping')).rejects.toBeInstanceOf(
      DispatchError,
    );
  });
});
