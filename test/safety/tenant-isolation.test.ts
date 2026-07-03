import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { applyMigrations } from '../../src/db/migrate';
import { withTenant, withoutTenant } from '../../src/modules/tenancy/tenant-context';

/**
 * TENANT-ISOLATION SAFETY SUITE (🔴 B1).
 *
 * Real adversarial tests against Postgres RLS. Requires DATABASE_URL pointing at
 * a database whose app role is NON-superuser and NON-bypassrls (so FORCE RLS is
 * genuinely exercised). Skips cleanly if DATABASE_URL is absent.
 */
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('tenant isolation (RLS)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    await pool.query('TRUNCATE tenant_settings, tenants RESTART IDENTITY CASCADE');
    await db.insert(schema.tenants).values([
      { id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'Tenant A' },
      { id: tenantB, slug: 'b-' + tenantB.slice(0, 8), name: 'Tenant B' },
    ]);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE tenant_settings');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('the app role is not a superuser and does not bypass RLS', async () => {
    const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it('a query under tenant A never returns tenant B rows', async () => {
    await withTenant(db, tenantA, (tx) =>
      tx.insert(schema.tenantSettings).values({ tenantId: tenantA, key: 'k' }),
    );
    await withTenant(db, tenantB, (tx) =>
      tx.insert(schema.tenantSettings).values({ tenantId: tenantB, key: 'k' }),
    );

    const seenByA = await withTenant(db, tenantA, (tx) =>
      tx.select().from(schema.tenantSettings),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0].tenantId).toBe(tenantA);
  });

  it('RLS is FORCEd — the table owner is still subject to it (no full-table read)', async () => {
    await withTenant(db, tenantA, (tx) =>
      tx.insert(schema.tenantSettings).values({ tenantId: tenantA, key: 'k' }),
    );
    await withTenant(db, tenantB, (tx) =>
      tx.insert(schema.tenantSettings).values({ tenantId: tenantB, key: 'k' }),
    );
    // app_user OWNS the table; without FORCE it would see both rows here.
    const seenByB = await withTenant(db, tenantB, (tx) =>
      tx.select().from(schema.tenantSettings),
    );
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0].tenantId).toBe(tenantB);
  });

  it('missing tenant context fails closed: zero rows, never all rows', async () => {
    await withTenant(db, tenantA, (tx) =>
      tx.insert(schema.tenantSettings).values({ tenantId: tenantA, key: 'k' }),
    );
    const seenNoContext = await withoutTenant(db, (tx) =>
      tx.select().from(schema.tenantSettings),
    );
    expect(seenNoContext).toHaveLength(0);
  });

  it('a client-supplied tenant_id different from the context is rejected on write', async () => {
    // Under tenant A's context, try to write a row stamped for tenant B.
    await expect(
      withTenant(db, tenantA, (tx) =>
        tx.insert(schema.tenantSettings).values({ tenantId: tenantB, key: 'forged' }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a write with no tenant context fails closed', async () => {
    await expect(
      withoutTenant(db, (tx) =>
        tx.insert(schema.tenantSettings).values({ tenantId: tenantA, key: 'x' }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('concurrent cross-fire: parallel A and B contexts never leak into each other', async () => {
    await withTenant(db, tenantA, (tx) =>
      tx.insert(schema.tenantSettings).values({ tenantId: tenantA, key: 'k' }),
    );
    await withTenant(db, tenantB, (tx) =>
      tx.insert(schema.tenantSettings).values({ tenantId: tenantB, key: 'k' }),
    );

    const [a, b] = await Promise.all([
      withTenant(db, tenantA, (tx) => tx.select().from(schema.tenantSettings)),
      withTenant(db, tenantB, (tx) => tx.select().from(schema.tenantSettings)),
    ]);
    expect(a.map((r) => r.tenantId)).toEqual([tenantA]);
    expect(b.map((r) => r.tenantId)).toEqual([tenantB]);
  });
});
