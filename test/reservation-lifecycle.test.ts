import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import { ReservationService } from '../src/vertical/restaurants/reservation.service';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('reservation lifecycle + staff (R1.7/R1.8)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let restaurant: RestaurantService;
  let reservations: ReservationService;
  const tenantA = randomUUID();
  let branchId: string;
  let tableId: string;
  const at = (h: number) => new Date(`2026-07-11T${String(h).padStart(2, '0')}:00:00Z`);

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
    await db.insert(schema.tenants).values({ id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' });
    const branch = await restaurant.createBranch(tenantA, { name: 'Main' });
    branchId = branch.id;
    const table = await restaurant.addTable(tenantA, { branchId, name: 'T1', capacity: 4 });
    tableId = table.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  const book = (h: number) =>
    reservations.book(tenantA, { branchId, tableId, partySize: 2, startsAt: at(h), durationMin: 90 });

  it('cancelling frees the slot for a new booking', async () => {
    const r = await book(19);
    await reservations.cancel(tenantA, r.id);
    const again = await book(19); // same slot, now free
    expect(again.status).toBe('confirmed');
  });

  it('modifying moves the booking and frees the old slot', async () => {
    const r = await book(19);
    await reservations.modify(tenantA, r.id, { startsAt: at(21), durationMin: 60 });
    const atNineteen = await book(19);
    expect(atNineteen.status).toBe('confirmed');
  });

  it('marks a no-show', async () => {
    const r = await book(19);
    const updated = await reservations.setStatus(tenantA, r.id, 'no_show');
    expect(updated.status).toBe('no_show');
  });

  it('waitlists without a table, then promotes onto one', async () => {
    const w = await reservations.addToWaitlist(tenantA, {
      branchId,
      partySize: 2,
      startsAt: at(19),
      durationMin: 90,
    });
    expect(w.status).toBe('waitlisted');
    expect(w.tableId).toBeNull();
    const promoted = await reservations.promoteFromWaitlist(tenantA, w.id, tableId);
    expect(promoted.status).toBe('confirmed');
    expect(promoted.tableId).toBe(tableId);
  });

  it('staff can list the reservations for a branch', async () => {
    await book(18);
    await book(20);
    const list = await reservations.listReservations(tenantA, branchId);
    expect(list).toHaveLength(2);
  });
});
