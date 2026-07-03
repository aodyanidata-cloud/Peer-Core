import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { closeDb } from '../src/db';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('catalog (B3)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let catalog: CatalogService;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    // TenancyService uses the shared getDb(), which connects to the same
    // DATABASE_URL — same Postgres DB as our test pool, so data is shared.
    catalog = new CatalogService(new TenancyService());
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE catalog_items, catalog_categories, tenants RESTART IDENTITY CASCADE');
    await db.insert(schema.tenants).values([
      { id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' },
      { id: tenantB, slug: 'b-' + tenantB.slice(0, 8), name: 'B' },
    ]);
  });

  afterAll(async () => {
    await closeDb();
    await pool.end();
  });

  it('stores price as integer minor units and round-trips attributes', async () => {
    const item = await catalog.createItem(tenantA, {
      name: 'Widget',
      priceMinor: 1550,
      attributes: { size: 'L', tags: ['a', 'b'] },
    });
    expect(item.priceMinor).toBe(1550);
    expect(item.currency).toBe('SAR');
    expect(item.attributes).toEqual({ size: 'L', tags: ['a', 'b'] });
  });

  it('rejects a non-integer or negative price', async () => {
    await expect(
      catalog.createItem(tenantA, { name: 'x', priceMinor: 9.99 }),
    ).rejects.toThrow(/minor units/);
    await expect(
      catalog.createItem(tenantA, { name: 'x', priceMinor: -1 }),
    ).rejects.toThrow(/minor units/);
  });

  it('is tenant-isolated: one tenant never sees another tenant catalog', async () => {
    await catalog.createItem(tenantA, { name: 'A-item', priceMinor: 100 });
    await catalog.createItem(tenantB, { name: 'B-item', priceMinor: 200 });

    const aItems = await catalog.listItems(tenantA);
    expect(aItems).toHaveLength(1);
    expect(aItems[0].name).toBe('A-item');
  });

  it('enforces the item status set (available|sold_out|hidden)', async () => {
    const item = await catalog.createItem(tenantA, { name: 'Widget', priceMinor: 100 });
    const updated = await catalog.setItemStatus(tenantA, item.id, 'sold_out');
    expect(updated.status).toBe('sold_out');
  });
});
