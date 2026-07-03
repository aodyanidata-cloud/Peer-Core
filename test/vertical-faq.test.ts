import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import { FaqService } from '../src/vertical/restaurants/faq.service';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('FAQ / info (R1.5)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let restaurant: RestaurantService;
  let faq: FaqService;
  const tenantA = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    const tenancy = new TenancyService();
    restaurant = new RestaurantService(tenancy);
    faq = new FaqService(tenancy);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE branches, tenants RESTART IDENTITY CASCADE');
    await db
      .insert(schema.tenants)
      .values({ id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('answers hours and location deterministically from structured fields', async () => {
    const branch = await restaurant.createBranch(tenantA, {
      name: 'Downtown',
      address: '1 King Fahd Rd',
      phone: '+966110000000',
      hours: { mon: [['09:00', '23:00']], fri: [['13:00', '01:00']] },
    });
    const info = await faq.branchInfo(tenantA, branch.id);
    expect(info?.address).toBe('1 King Fahd Rd');
    expect(info?.phone).toBe('+966110000000');

    const mon = await faq.hoursForDay(tenantA, branch.id, 'MON');
    expect(mon).toEqual([['09:00', '23:00']]);
    const sun = await faq.hoursForDay(tenantA, branch.id, 'sun');
    expect(sun).toEqual([]); // no hours declared -> empty, never invented
  });
});
