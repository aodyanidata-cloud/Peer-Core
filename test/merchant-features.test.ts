import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import { MenuService } from '../src/vertical/restaurants/menu.service';
import { OrderService } from '../src/vertical/restaurants/order.service';
import { PromotionService } from '../src/vertical/restaurants/promotion.service';
import { LoyaltyService } from '../src/vertical/restaurants/loyalty.service';
import { ReviewService } from '../src/vertical/restaurants/review.service';
import { DriverDirectoryService } from '../src/vertical/restaurants/driver-directory.service';
import { FakePaymentProvider } from '../src/modules/payments/fake-payment-provider';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('merchant features (promotions, loyalty, reviews, directory, scheduled)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let menu: MenuService;
  let restaurant: RestaurantService;
  let orders: OrderService;
  let promos: PromotionService;
  let loyalty: LoyaltyService;
  let reviews: ReviewService;
  let drivers: DriverDirectoryService;
  const tenantA = randomUUID();
  let branchId: string;
  let itemId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    const tenancy = new TenancyService();
    menu = new MenuService(tenancy, new CatalogService(tenancy));
    restaurant = new RestaurantService(tenancy);
    orders = new OrderService(tenancy, new FakePaymentProvider());
    promos = new PromotionService(tenancy);
    loyalty = new LoyaltyService(tenancy);
    reviews = new ReviewService(tenancy);
    drivers = new DriverDirectoryService(tenancy);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE reviews, loyalty_ledger, loyalty_accounts, promotions, driver_listings, payments, order_events, order_items, orders, catalog_items, branches, tenants RESTART IDENTITY CASCADE',
    );
    await db.insert(schema.tenants).values({ id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' });
    const b = await restaurant.createBranch(tenantA, { name: 'Main' });
    branchId = b.id;
    const item = await menu.createItem(tenantA, { name: 'Plate', priceMinor: 2000 });
    itemId = item.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  const order = (over = {}) =>
    orders.checkout(tenantA, { branchId, orderType: 'pickup', lines: [{ itemId, quantity: 1 }], ...over });

  it('applies a percent promotion; VAT is on the discounted base; redemption counts', async () => {
    await promos.create(tenantA, { code: 'SAVE10', kind: 'percent', value: 10 });
    const o = await order({ promoCode: 'SAVE10' });
    // subtotal 2000, -10% = 200 discount, base 1800, VAT 270, total 2070
    expect(o.discountMinor).toBe(200);
    expect(o.totalMinor).toBe(2070);
    expect(o.promotionCode).toBe('SAVE10');
    const [p] = await promos.list(tenantA);
    expect(p.redeemedCount).toBe(1);
  });

  it('applies a fixed-amount promotion', async () => {
    await promos.create(tenantA, { code: 'MINUS5', kind: 'amount', value: 500 });
    const o = await order({ promoCode: 'MINUS5' });
    // subtotal 2000, -500, base 1500, VAT 225, total 1725
    expect(o.totalMinor).toBe(1725);
  });

  it('rejects an invalid or below-minimum promo', async () => {
    await expect(order({ promoCode: 'NOPE' })).rejects.toMatchObject({ code: 'bad_promo' });
    await promos.create(tenantA, { code: 'BIG', kind: 'amount', value: 100, minOrderMinor: 100000 });
    await expect(order({ promoCode: 'BIG' })).rejects.toMatchObject({ code: 'bad_promo' });
  });

  it('awards loyalty points when an order completes (1 point per SAR)', async () => {
    const o = await order({ dinerPhone: '+966500000001' });
    await orders.accept(tenantA, o.id);
    await orders.advance(tenantA, o.id, 'PREPARING');
    await orders.advance(tenantA, o.id, 'READY');
    await orders.advance(tenantA, o.id, 'PICKED_UP');
    await orders.advance(tenantA, o.id, 'COMPLETE');
    // total 2300 (2000 + 15% VAT) -> 23 points
    expect(await loyalty.balance(tenantA, '+966500000001')).toBe(23);
  });

  it('allows a review only after COMPLETE, once per order', async () => {
    const o = await order({ dinerPhone: '+966500000001' });
    await expect(reviews.submit(tenantA, { orderId: o.id, rating: 5 })).rejects.toMatchObject({
      code: 'order_not_complete',
    });
    await orders.accept(tenantA, o.id);
    await orders.advance(tenantA, o.id, 'PREPARING');
    await orders.advance(tenantA, o.id, 'READY');
    await orders.advance(tenantA, o.id, 'PICKED_UP');
    await orders.advance(tenantA, o.id, 'COMPLETE');
    const r = await reviews.submit(tenantA, { orderId: o.id, rating: 5, comment: 'great' });
    expect(r.rating).toBe(5);
    await expect(reviews.submit(tenantA, { orderId: o.id, rating: 4 })).rejects.toThrow();
    const s = await reviews.summary(tenantA);
    expect(s).toEqual({ count: 1, average: 5 });
  });

  it('driver directory: add, list by area, verify', async () => {
    await drivers.add(tenantA, { name: 'Ali', phone: '+966500000001', areas: 'Riyadh, Olaya', vehicleType: 'car' });
    const inRiyadh = await drivers.list(tenantA, 'Olaya');
    expect(inRiyadh).toHaveLength(1);
    expect(inRiyadh[0].name).toBe('Ali');
  });

  it('supports a scheduled (advance) order', async () => {
    const when = new Date('2026-07-20T13:00:00Z');
    const o = await order({ scheduledFor: when });
    expect(o.scheduledFor?.toISOString()).toBe(when.toISOString());
  });
});
