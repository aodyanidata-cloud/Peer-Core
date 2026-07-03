import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { applyMigrations } from '../../src/db/migrate';
import { TenancyService } from '../../src/modules/tenancy/tenancy.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { RestaurantService } from '../../src/vertical/restaurants/restaurant.service';
import { MenuService } from '../../src/vertical/restaurants/menu.service';
import { OrderService } from '../../src/vertical/restaurants/order.service';
import { FakePaymentProvider } from '../../src/modules/payments/fake-payment-provider';
import { computeTotals } from '../../src/vertical/restaurants/pricing';
import { withTenant } from '../../src/modules/tenancy/tenant-context';

/**
 * ORDER / MONEY SAFETY SUITE (🔴 R2). Real tests against Postgres + the fake
 * two-phase payment provider.
 */
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('order & money safety', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let menu: MenuService;
  let restaurant: RestaurantService;
  let orders: OrderService;
  let payments: FakePaymentProvider;
  const tenantA = randomUUID();
  let branchId: string;
  let burgerId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    const tenancy = new TenancyService();
    menu = new MenuService(tenancy, new CatalogService(tenancy));
    restaurant = new RestaurantService(tenancy);
    payments = new FakePaymentProvider();
    orders = new OrderService(tenancy, payments);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE payments, order_events, order_items, orders, catalog_items, branches, tenants RESTART IDENTITY CASCADE',
    );
    await db.insert(schema.tenants).values({ id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' });
    const branch = await restaurant.createBranch(tenantA, { name: 'Main' });
    branchId = branch.id;
    const burger = await menu.createItem(tenantA, {
      name: 'Burger',
      priceMinor: 2000,
      modifierGroups: [
        {
          name: 'Extras',
          minSelect: 0,
          maxSelect: 2,
          required: false,
          options: [
            { name: 'Cheese', priceDeltaMinor: 300 },
            { name: 'Bacon', priceDeltaMinor: 500 },
          ],
        },
      ],
    });
    burgerId = burger.id;
    payments.failNext = false;
  });

  afterAll(async () => {
    await pool.end();
  });

  const co = (over: Partial<Parameters<OrderService['checkout']>[1]> = {}) =>
    orders.checkout(tenantA, {
      branchId,
      orderType: 'pickup',
      lines: [{ itemId: burgerId, quantity: 2 }],
      ...over,
    });

  it('pricing: server-side totals with modifier deltas and 15% VAT (pure)', () => {
    // 2 × (2000 + 300 cheese) = 4600 subtotal, VAT 690, total 5290
    const t = computeTotals(
      [{ unitPriceMinor: 2000, quantity: 2, modifiers: [{ name: 'Cheese', priceDeltaMinor: 300 }] }],
    );
    expect(t.subtotalMinor).toBe(4600);
    expect(t.vatMinor).toBe(690);
    expect(t.totalMinor).toBe(5290);
  });

  it('totals are computed server-side; a client cannot dictate the price', async () => {
    // The request carries no total/price; a bogus extra field is simply ignored.
    const order = await co({
      lines: [{ itemId: burgerId, quantity: 2 }],
      // @ts-expect-error — there is deliberately no price input on the API
      totalMinor: 1,
    });
    expect(order.subtotalMinor).toBe(4000);
    expect(order.vatMinor).toBe(600);
    expect(order.totalMinor).toBe(4600);
  });

  it('a forged modifier (not on the item) is rejected — no invented pricing', async () => {
    await expect(
      co({ lines: [{ itemId: burgerId, quantity: 1, modifiers: [{ group: 'Extras', option: 'Truffle' }] }] }),
    ).rejects.toMatchObject({ code: 'bad_modifier' });
  });

  it('a declined authorization creates no order', async () => {
    payments.failNext = true;
    await expect(co()).rejects.toThrow(/declined/);
    const rows = await withTenant(db, tenantA, (tx) => tx.select().from(schema.orders));
    expect(rows).toHaveLength(0); // authorize-before-order; nothing persisted
  });

  it('a duplicate checkout with the same idempotency key yields one order', async () => {
    const a = await co({ idempotencyKey: 'k-1' });
    const b = await co({ idempotencyKey: 'k-1' });
    expect(b.id).toBe(a.id);
    const rows = await withTenant(db, tenantA, (tx) => tx.select().from(schema.orders));
    expect(rows).toHaveLength(1);
  });

  it('only legal state transitions are allowed', async () => {
    const order = await co();
    await expect(orders.advance(tenantA, order.id, 'DELIVERED')).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });

  it('accept captures; reject voids; cancel-after-accept refunds', async () => {
    // accept -> capture
    const o1 = await co();
    const accepted = await orders.accept(tenantA, o1.id);
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.paymentStatus).toBe('captured');

    // reject -> void
    const o2 = await co();
    const rejected = await orders.reject(tenantA, o2.id);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.paymentStatus).toBe('voided');

    // cancel after accept -> refund
    const o3 = await co();
    await orders.accept(tenantA, o3.id);
    const cancelled = await orders.cancel(tenantA, o3.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.paymentStatus).toBe('refunded');
  });

  it('an unavailable (86ed) item cannot be ordered', async () => {
    await menu.setSoldOut(tenantA, burgerId, true);
    await expect(co()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('the full happy path advances to COMPLETE', async () => {
    const o = await co();
    await orders.accept(tenantA, o.id);
    await orders.advance(tenantA, o.id, 'PREPARING');
    await orders.advance(tenantA, o.id, 'READY');
    await orders.advance(tenantA, o.id, 'PICKED_UP');
    const done = await orders.advance(tenantA, o.id, 'COMPLETE');
    expect(done.status).toBe('COMPLETE');
    expect(done.paymentStatus).toBe('captured'); // captured at accept, never refunded
  });
});
