import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import { MenuService } from '../src/vertical/restaurants/menu.service';
import { OrderService } from '../src/vertical/restaurants/order.service';
import { CartService } from '../src/vertical/restaurants/cart.service';
import { DeliveryService } from '../src/vertical/restaurants/delivery.service';
import { FakePaymentProvider } from '../src/modules/payments/fake-payment-provider';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { LoggingSmsProvider } from '../src/modules/channels/logging-adapters';
import { WhatsAppProvider } from '../src/modules/channels/whatsapp-provider';
import { withTenant } from '../src/modules/tenancy/tenant-context';
import { closeDb } from '../src/db';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('R2 flow: cart, delivery ledger, order notifications', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let menu: MenuService;
  let restaurant: RestaurantService;
  let orders: OrderService;
  let cart: CartService;
  let delivery: DeliveryService;
  let wa: WhatsAppProvider;
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
    wa = new WhatsAppProvider();
    const notifier = new NotificationService(tenancy, new LoggingSmsProvider(), wa);
    orders = new OrderService(tenancy, new FakePaymentProvider(), notifier);
    cart = new CartService(tenancy, orders);
    delivery = new DeliveryService(tenancy);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE driver_earnings, deliveries, cart_items, carts, payments, order_events, order_items, orders, catalog_items, branches, tenants RESTART IDENTITY CASCADE',
    );
    await db.insert(schema.tenants).values({ id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' });
    const b = await restaurant.createBranch(tenantA, { name: 'Main' });
    branchId = b.id;
    const item = await menu.createItem(tenantA, { name: 'Shawarma', priceMinor: 2000 });
    itemId = item.id;
    wa.sent.length = 0;
  });

  afterAll(async () => {
    await closeDb();
    await pool.end();
  });

  it('cart: add items, quote server-side, then checkout into one order', async () => {
    const c = await cart.createCart(tenantA, branchId);
    await cart.addItem(tenantA, c.id, { itemId, quantity: 3 });
    const quote = await cart.quote(tenantA, c.id);
    expect(quote.subtotalMinor).toBe(6000);
    expect(quote.vatMinor).toBe(900);
    expect(quote.totalMinor).toBe(6900);

    const order = await cart.checkout(tenantA, c.id, { branchId, orderType: 'pickup' });
    expect(order.totalMinor).toBe(6900);
    const [refreshed] = await withTenant(db, tenantA, (tx) =>
      tx.select().from(schema.carts).where(eq(schema.carts.id, c.id)),
    );
    expect(refreshed?.status).toBe('checked_out');
  });

  it('delivery: driver earnings ledger tallies then settles', async () => {
    const order = await orders.checkout(tenantA, {
      branchId,
      orderType: 'delivery',
      lines: [{ itemId, quantity: 1 }],
    });
    await delivery.assign(tenantA, order.id, { name: 'Ali', phone: '+966500000001' }, 900);
    // Reassigning the SAME order REPLACES the earning (no double-count).
    await delivery.assign(tenantA, order.id, { name: 'Ali', phone: '+966500000001' }, 1100);
    expect(await delivery.owed(tenantA, '+966500000001')).toBe(1100);
    await delivery.settle(tenantA, '+966500000001', new Date('2026-07-20T00:00:00Z'));
    expect(await delivery.owed(tenantA, '+966500000001')).toBe(0);
  });

  it('order status changes proactively notify the diner', async () => {
    const order = await orders.checkout(tenantA, {
      branchId,
      orderType: 'pickup',
      lines: [{ itemId, quantity: 1 }],
      dinerPhone: '+966500000009',
    });
    await orders.accept(tenantA, order.id); // ACCEPTED -> "confirmed"
    await orders.advance(tenantA, order.id, 'PREPARING'); // no notify
    await orders.advance(tenantA, order.id, 'READY'); // "ready"
    const events = wa.sent.map((m) => m.body);
    expect(events.some((b) => /confirmed/i.test(b))).toBe(true);
    expect(events.some((b) => /ready/i.test(b))).toBe(true);
    expect(wa.sent).toHaveLength(2); // ACCEPTED + READY only
  });
});
