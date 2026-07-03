import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import {
  MenuService,
  validateModifierGroups,
  type ModifierGroup,
} from '../src/vertical/restaurants/menu.service';
import { closeDb } from '../src/db';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('restaurants vertical R1.1/R1.2', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let restaurant: RestaurantService;
  let menu: MenuService;
  const tenantA = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    const tenancy = new TenancyService();
    restaurant = new RestaurantService(tenancy);
    menu = new MenuService(tenancy, new CatalogService(tenancy));
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE menu_availability, restaurant_tables, branches, catalog_items, tenants RESTART IDENTITY CASCADE',
    );
    await db
      .insert(schema.tenants)
      .values({ id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' });
  });

  afterAll(async () => {
    await closeDb();
    await pool.end();
  });

  it('creates a branch and tables (R1.1)', async () => {
    const branch = await restaurant.createBranch(tenantA, {
      name: 'Downtown',
      hours: { mon: [['09:00', '23:00']] },
    });
    const table = await restaurant.addTable(tenantA, {
      branchId: branch.id,
      name: 'T1',
      capacity: 4,
    });
    expect(table.capacity).toBe(4);
    const tables = await restaurant.listTables(tenantA, branch.id);
    expect(tables).toHaveLength(1);
  });

  it('rejects a non-positive table capacity', async () => {
    const branch = await restaurant.createBranch(tenantA, { name: 'B' });
    await expect(
      restaurant.addTable(tenantA, { branchId: branch.id, name: 'x', capacity: 0 }),
    ).rejects.toThrow(/positive integer/);
  });

  it('creates a menu item with modifier groups stored in attributes (R1.2)', async () => {
    const item = await menu.createItem(tenantA, {
      name: 'Burger',
      priceMinor: 2500,
      allergens: ['gluten'],
      modifierGroups: [
        {
          name: 'Size',
          minSelect: 1,
          maxSelect: 1,
          required: true,
          options: [
            { name: 'Regular', priceDeltaMinor: 0 },
            { name: 'Large', priceDeltaMinor: 500 },
          ],
        },
      ],
    });
    const attrs = item.attributes as { modifierGroups: ModifierGroup[]; allergens: string[] };
    expect(attrs.modifierGroups[0].name).toBe('Size');
    expect(attrs.allergens).toEqual(['gluten']);
  });

  it('validates modifier groups (min<=max, required needs min>=1)', () => {
    expect(() =>
      validateModifierGroups([
        { name: 'X', minSelect: 2, maxSelect: 1, required: false, options: [] },
      ]),
    ).toThrow(/min <= max/);
    expect(() =>
      validateModifierGroups([
        {
          name: 'X',
          minSelect: 0,
          maxSelect: 1,
          required: true,
          options: [{ name: 'a', priceDeltaMinor: 0 }],
        },
      ]),
    ).toThrow(/required needs min/);
  });

  it('per-branch availability overrides a globally-available item (R1.2)', async () => {
    const branch = await restaurant.createBranch(tenantA, { name: 'B' });
    const item = await menu.createItem(tenantA, { name: 'Soup', priceMinor: 900 });
    expect(await menu.isAvailableAtBranch(tenantA, item.id, branch.id)).toBe(true);
    await menu.setBranchAvailability(tenantA, item.id, branch.id, false);
    expect(await menu.isAvailableAtBranch(tenantA, item.id, branch.id)).toBe(false);
  });

  it('"86" (sold-out) makes an item unavailable everywhere (R1.2)', async () => {
    const branch = await restaurant.createBranch(tenantA, { name: 'B' });
    const item = await menu.createItem(tenantA, { name: 'Special', priceMinor: 1200 });
    await menu.setSoldOut(tenantA, item.id, true);
    expect(await menu.isAvailableAtBranch(tenantA, item.id, branch.id)).toBe(false);
  });
});
