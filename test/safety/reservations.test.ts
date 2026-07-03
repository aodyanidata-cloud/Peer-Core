import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { applyMigrations } from '../../src/db/migrate';
import { TenancyService } from '../../src/modules/tenancy/tenancy.service';
import { RestaurantService } from '../../src/vertical/restaurants/restaurant.service';
import {
  ReservationService,
  ReservationError,
} from '../../src/vertical/restaurants/reservation.service';
import { withTenant } from '../../src/modules/tenancy/tenant-context';

/**
 * RESERVATIONS SAFETY SUITE (R1.6, concurrency-critical — Gate G6).
 * The headline test fires two concurrent bookings for the same table+slot and
 * proves exactly one wins — the DB exclusion constraint, not app logic.
 */
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('reservations — atomic double-booking prevention', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let restaurant: RestaurantService;
  let reservations: ReservationService;
  const tenantA = randomUUID();
  let branchId: string;
  let tableId: string;

  const at = (h: number) => new Date(`2026-07-10T${String(h).padStart(2, '0')}:00:00Z`);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    const tenancy = new TenancyService();
    restaurant = new RestaurantService(tenancy);
    reservations = new ReservationService(tenancy);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE reservations, restaurant_tables, branches, tenants RESTART IDENTITY CASCADE',
    );
    await db
      .insert(schema.tenants)
      .values({ id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' });
    const branch = await restaurant.createBranch(tenantA, { name: 'Main' });
    branchId = branch.id;
    const table = await restaurant.addTable(tenantA, {
      branchId,
      name: 'T1',
      capacity: 4,
    });
    tableId = table.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('books a table when free', async () => {
    const r = await reservations.book(tenantA, {
      branchId,
      tableId,
      partySize: 2,
      startsAt: at(19),
      durationMin: 90,
    });
    expect(r.status).toBe('confirmed');
  });

  it('rejects a party larger than the table', async () => {
    await expect(
      reservations.book(tenantA, {
        branchId,
        tableId,
        partySize: 6,
        startsAt: at(19),
        durationMin: 90,
      }),
    ).rejects.toMatchObject({ code: 'over_capacity' });
  });

  it('rejects an overlapping booking on the same table', async () => {
    await reservations.book(tenantA, {
      branchId,
      tableId,
      partySize: 2,
      startsAt: at(19),
      durationMin: 120,
    });
    await expect(
      reservations.book(tenantA, {
        branchId,
        tableId,
        partySize: 2,
        startsAt: at(20), // overlaps 19:00–21:00
        durationMin: 60,
      }),
    ).rejects.toMatchObject({ code: 'slot_taken' });
  });

  it('allows a non-overlapping booking on the same table', async () => {
    await reservations.book(tenantA, {
      branchId,
      tableId,
      partySize: 2,
      startsAt: at(18),
      durationMin: 60,
    });
    const later = await reservations.book(tenantA, {
      branchId,
      tableId,
      partySize: 2,
      startsAt: at(20),
      durationMin: 60,
    });
    expect(later.status).toBe('confirmed');
  });

  it('ATOMIC: two concurrent bookings for the same slot — exactly one wins', async () => {
    const mk = () =>
      reservations.book(tenantA, {
        branchId,
        tableId,
        partySize: 2,
        startsAt: at(19),
        durationMin: 90,
      });

    const results = await Promise.allSettled([mk(), mk()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ReservationError,
    );

    // And the database holds exactly one active reservation for that table.
    const rows = await withTenant(db, tenantA, (tx) =>
      tx.select().from(schema.reservations),
    );
    expect(rows).toHaveLength(1);
  });
});
