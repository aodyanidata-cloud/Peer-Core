import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { applyMigrations } from '../../src/db/migrate';
import { TenancyService } from '../../src/modules/tenancy/tenancy.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { RestaurantService } from '../../src/vertical/restaurants/restaurant.service';
import { MenuService } from '../../src/vertical/restaurants/menu.service';
import { OrderService } from '../../src/vertical/restaurants/order.service';
import { AuthService } from '../../src/modules/identity/auth.service';
import type { OtpSender } from '../../src/modules/identity/otp-sender';
import { FakePaymentProvider } from '../../src/modules/payments/fake-payment-provider';
import { withTenant } from '../../src/modules/tenancy/tenant-context';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

class CapturingOtp implements OtpSender {
  count = 0;
  async send() {
    this.count += 1;
  }
}

d('hardening: modifier enforcement, checkout guards, optimistic lock, OTP rate-limit', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let menu: MenuService;
  let restaurant: RestaurantService;
  let orders: OrderService;
  const tenantA = randomUUID();
  let branchId: string;
  let plainId: string;
  let sizedId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    const tenancy = new TenancyService();
    menu = new MenuService(tenancy, new CatalogService(tenancy));
    restaurant = new RestaurantService(tenancy);
    orders = new OrderService(tenancy, new FakePaymentProvider());
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE payments, order_events, order_items, orders, menu_availability, catalog_items, branches, otp_challenges, sessions, users, tenants RESTART IDENTITY CASCADE',
    );
    await db.insert(schema.tenants).values({ id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' });
    const b = await restaurant.createBranch(tenantA, { name: 'Main' });
    branchId = b.id;
    const plain = await menu.createItem(tenantA, { name: 'Plate', priceMinor: 2000 });
    plainId = plain.id;
    const sized = await menu.createItem(tenantA, {
      name: 'Burger',
      priceMinor: 2000,
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
    sizedId = sized.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  const co = (over = {}) =>
    orders.checkout(tenantA, { branchId, orderType: 'pickup', lines: [{ itemId: plainId, quantity: 1 }], ...over });

  it('rejects an order that omits a required modifier group', async () => {
    await expect(
      co({ lines: [{ itemId: sizedId, quantity: 1 }] }),
    ).rejects.toMatchObject({ code: 'bad_modifier' });
  });

  it('rejects exceeding a modifier group max-select', async () => {
    await expect(
      co({
        lines: [
          {
            itemId: sizedId,
            quantity: 1,
            modifiers: [
              { group: 'Size', option: 'Regular' },
              { group: 'Size', option: 'Large' },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'bad_modifier' });
  });

  it('accepts a valid required-modifier selection', async () => {
    const o = await co({
      lines: [{ itemId: sizedId, quantity: 1, modifiers: [{ group: 'Size', option: 'Large' }] }],
    });
    expect(o.status).toBe('NEW');
  });

  it('rejects an empty order', async () => {
    await expect(co({ lines: [] })).rejects.toMatchObject({ code: 'bad_item' });
  });

  it('blocks an order below the branch minimum', async () => {
    await withTenant(db, tenantA, (tx) =>
      tx.update(schema.branches).set({ minOrderMinor: 100_000 }).where(eq(schema.branches.id, branchId)),
    );
    await expect(co()).rejects.toMatchObject({ code: 'below_minimum' });
  });

  it('blocks an order scheduled while the branch is closed, allows one while open', async () => {
    const hours: Record<string, [string, string][]> = Object.fromEntries(
      ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d2) => [d2, [['09:00', '17:00'] as [string, string]]]),
    );
    await withTenant(db, tenantA, (tx) =>
      tx.update(schema.branches).set({ hours }).where(eq(schema.branches.id, branchId)),
    );
    // +3 days at 20:00 UTC — outside 09:00–17:00
    const closed = new Date(Date.now() + 3 * 86400_000);
    closed.setUTCHours(20, 0, 0, 0);
    await expect(co({ scheduledFor: closed })).rejects.toMatchObject({ code: 'closed' });
    const open = new Date(Date.now() + 3 * 86400_000);
    open.setUTCHours(12, 0, 0, 0);
    const ok = await co({ scheduledFor: open });
    expect(ok.status).toBe('NEW');
  });

  it('rejects a scheduled time in the past or too far out', async () => {
    await expect(co({ scheduledFor: new Date(Date.now() - 86400_000) })).rejects.toMatchObject({ code: 'bad_schedule' });
    await expect(co({ scheduledFor: new Date(Date.now() + 90 * 86400_000) })).rejects.toMatchObject({ code: 'bad_schedule' });
  });

  it('optimistic lock: concurrent transitions on one order — exactly one wins', async () => {
    const o = await co();
    await orders.accept(tenantA, o.id); // -> ACCEPTED
    const results = await Promise.allSettled([
      orders.advance(tenantA, o.id, 'PREPARING'),
      orders.advance(tenantA, o.id, 'PREPARING'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    // The loser is rejected as a concurrent change — caught either at the
    // optimistic-lock write (conflict) or, if the winner already committed
    // before the loser re-read, at the transition guard (illegal PREPARING→PREPARING).
    const reason = (bad[0] as PromiseRejectedResult).reason as { code?: string };
    expect(['conflict', 'illegal_transition']).toContain(reason.code);
    // Exactly one transition landed: one PREPARING event, order sits in PREPARING.
    const events = await withTenant(db, tenantA, (tx) =>
      tx
        .select()
        .from(schema.orderEvents)
        .where(and(eq(schema.orderEvents.orderId, o.id), eq(schema.orderEvents.toStatus, 'PREPARING'))),
    );
    expect(events).toHaveLength(1);
  });

  it('rate-limits OTP requests per phone', async () => {
    const sender = new CapturingOtp();
    const auth = new AuthService(db, sender);
    const phone = '+966500000123';
    await auth.requestOtp(phone);
    await auth.requestOtp(phone);
    await auth.requestOtp(phone);
    await expect(auth.requestOtp(phone)).rejects.toMatchObject({ code: 'otp_locked' });
    expect(sender.count).toBe(3);
  });

  it('holds the OTP cap under CONCURRENCY (no TOCTOU bypass)', async () => {
    const sender = new CapturingOtp();
    const auth = new AuthService(db, sender);
    const phone = '+966500000199';
    // Fire many in parallel: a count-then-insert race would let all through.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => auth.requestOtp(phone)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(3); // never more than the cap
    expect(sender.count).toBe(3);
    const rows = await db
      .select({ id: schema.otpChallenges.id })
      .from(schema.otpChallenges)
      .where(eq(schema.otpChallenges.phone, phone));
    expect(rows).toHaveLength(3); // and only 3 codes were ever persisted
  });

  it('evaluates branch hours in KSA-local time, not UTC', async () => {
    const hours: Record<string, [string, string][]> = Object.fromEntries(
      ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d2) => [d2, [['09:00', '17:00'] as [string, string]]]),
    );
    await withTenant(db, tenantA, (tx) =>
      tx.update(schema.branches).set({ hours }).where(eq(schema.branches.id, branchId)),
    );
    // 08:00 UTC = 11:00 KSA → OPEN (a UTC evaluation would wrongly call it closed).
    const openUtc = new Date(Date.now() + 2 * 86400_000);
    openUtc.setUTCHours(8, 0, 0, 0);
    const ok = await co({ scheduledFor: openUtc });
    expect(ok.status).toBe('NEW');
    // 15:00 UTC = 18:00 KSA → CLOSED (a UTC evaluation would wrongly call it open).
    const closedUtc = new Date(Date.now() + 2 * 86400_000);
    closedUtc.setUTCHours(15, 0, 0, 0);
    await expect(co({ scheduledFor: closedUtc })).rejects.toMatchObject({ code: 'closed' });
  });

  it('blocks ordering an item 86ed at the branch, even if globally available', async () => {
    await menu.setBranchAvailability(tenantA, plainId, branchId, false);
    await expect(co()).rejects.toMatchObject({ code: 'unavailable' });
    await menu.setBranchAvailability(tenantA, plainId, branchId, true);
    const ok = await co();
    expect(ok.status).toBe('NEW');
  });

  it('captures at most once under concurrent accept — money op is behind the lock', async () => {
    const o = await co();
    const results = await Promise.allSettled([
      orders.accept(tenantA, o.id),
      orders.accept(tenantA, o.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    // Exactly one capture row exists — the loser never reached the money op.
    const caps = await withTenant(db, tenantA, (tx) =>
      tx
        .select()
        .from(schema.payments)
        .where(and(eq(schema.payments.orderId, o.id), eq(schema.payments.action, 'capture'))),
    );
    expect(caps).toHaveLength(1);
  });
});
