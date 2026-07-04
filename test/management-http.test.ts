import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as schema from '../src/db/schema';
import { createApp } from '../src/main';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OnboardingService } from '../src/vertical/restaurants/onboarding.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import { MenuService } from '../src/vertical/restaurants/menu.service';
import { AuthService } from '../src/modules/identity/auth.service';
import type { OtpSender } from '../src/modules/identity/otp-sender';
import { closeDb } from '../src/db';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

class CapturingOtp implements OtpSender {
  last = new Map<string, string>();
  async send(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

/**
 * Reachability suite: every merchant-management service (branches, menu,
 * promotions, loyalty, reviews, complaints, delivery, drivers) and the diner
 * self-service surface (complaint, review, cart) must be callable over HTTP,
 * behind the correct guard. A service with no route is dead code from the
 * product's perspective; this proves each one is wired.
 */
d('management + diner self-service over HTTP', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let token: string;
  const slug = 'grill-house';
  const ownerPhone = '+966500000021';
  let branchId: string;

  const auth = (r: supertest.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    await pool.query(
      'TRUNCATE driver_listings, driver_earnings, deliveries, complaints, reviews, promotions, loyalty_ledger, loyalty_accounts, cart_items, carts, sessions, otp_challenges, memberships, users, payments, order_events, order_items, orders, catalog_items, menu_availability, branches, tenants RESTART IDENTITY CASCADE',
    );
    const tenancy = new TenancyService();
    const { tenantId, branchId: b } = await new OnboardingService(
      new RestaurantService(tenancy),
    ).onboard({ name: 'Grill House', slug, ownerPhone, branchName: 'HQ' });
    branchId = b;
    await new MenuService(tenancy, new CatalogService(tenancy)).createItem(tenantId, {
      name: 'Falafel',
      priceMinor: 1500,
    });

    const cap = new CapturingOtp();
    const authSvc = new AuthService(db, cap);
    await authSvc.requestOtp(ownerPhone);
    const res = await authSvc.verifyOtp(ownerPhone, cap.last.get(ownerPhone)!);
    token = res.token;

    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await pool.end();
  });

  it('guards every management route (no token → 401)', async () => {
    for (const path of [
      '/api/v1/staff/branches',
      '/api/v1/staff/promotions',
      '/api/v1/staff/complaints',
      '/api/v1/staff/reviews/summary',
      '/api/v1/staff/driver-directory',
    ]) {
      const res = await supertest(app.getHttpServer()).get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('manages branches (list, update min-order + hours)', async () => {
    const list = await auth(supertest(app.getHttpServer()).get('/api/v1/staff/branches'));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    // Open every day, all hours, so downstream "place order now" tests aren't
    // caught by the closed-hours guard.
    const hours = Object.fromEntries(
      ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [
        day,
        [['00:00', '23:59']],
      ]),
    );
    const patched = await auth(
      supertest(app.getHttpServer()).patch(`/api/v1/staff/branches/${branchId}`),
    ).send({ minOrderMinor: 2500, hours });
    expect(patched.status).toBe(200);
    expect(patched.body.minOrderMinor).toBe(2500);
  });

  it('manages menu (create, sold-out, KB sync)', async () => {
    const created = await auth(
      supertest(app.getHttpServer()).post('/api/v1/staff/menu/items'),
    ).send({ name: 'Hummus', priceMinor: 1200 });
    expect(created.status).toBe(201);
    const itemId = created.body.id;

    const soldOut = await auth(
      supertest(app.getHttpServer()).post(`/api/v1/staff/menu/items/${itemId}/sold-out`),
    ).send({ soldOut: true });
    expect(soldOut.status).toBe(201);

    const synced = await auth(
      supertest(app.getHttpServer()).post('/api/v1/staff/menu/sync'),
    );
    expect(synced.status).toBe(201);
    expect(synced.body.indexed).toBeGreaterThan(0);
  });

  it('manages promotions (create, list, deactivate)', async () => {
    const created = await auth(
      supertest(app.getHttpServer()).post('/api/v1/staff/promotions'),
    ).send({ code: 'WELCOME10', kind: 'percent', value: 10 });
    expect(created.status).toBe(201);

    const list = await auth(supertest(app.getHttpServer()).get('/api/v1/staff/promotions'));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const off = await auth(
      supertest(app.getHttpServer()).post(`/api/v1/staff/promotions/${created.body.id}/deactivate`),
    );
    expect(off.status).toBe(201);
  });

  it('reads loyalty and review summary', async () => {
    const loyalty = await auth(
      supertest(app.getHttpServer()).get('/api/v1/staff/loyalty/+966511112222'),
    );
    expect(loyalty.status).toBe(200);
    expect(loyalty.body.balance).toBe(0);

    const reviews = await auth(supertest(app.getHttpServer()).get('/api/v1/staff/reviews/summary'));
    expect(reviews.status).toBe(200);
    expect(reviews.body).toMatchObject({ count: 0, average: 0 });
  });

  it('handles the delivery ledger + driver directory over HTTP', async () => {
    const added = await auth(
      supertest(app.getHttpServer()).post('/api/v1/staff/driver-directory'),
    ).send({ name: 'Sami', phone: '+966533334444', areas: 'North' });
    expect(added.status).toBe(201);

    const list = await auth(
      supertest(app.getHttpServer()).get('/api/v1/staff/driver-directory').query({ area: 'North' }),
    );
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const owed = await auth(
      supertest(app.getHttpServer()).get('/api/v1/staff/drivers/+966533334444/owed'),
    );
    expect(owed.status).toBe(200);
    expect(owed.body.owedMinor).toBe(0);

    const settled = await auth(
      supertest(app.getHttpServer()).post('/api/v1/staff/drivers/+966533334444/settle'),
    );
    expect(settled.status).toBe(201);
    expect(settled.body.settled).toBe(true);
  });

  it('lets a diner submit a complaint over HTTP', async () => {
    const res = await supertest(app.getHttpServer())
      .post(`/api/v1/r/${slug}/complaints`)
      .send({ subject: 'Cold food', body: 'The order arrived cold.', branchId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');

    const open = await auth(supertest(app.getHttpServer()).get('/api/v1/staff/complaints'));
    expect(open.status).toBe(200);
    expect(open.body).toHaveLength(1);

    const resolved = await auth(
      supertest(app.getHttpServer()).post(`/api/v1/staff/complaints/${res.body.id}/status`),
    ).send({ status: 'resolved' });
    expect(resolved.status).toBe(201);
    expect(resolved.body.status).toBe('resolved');
  });

  it('lets a diner submit a review, rejecting one on an incomplete order', async () => {
    const menuRes = await supertest(app.getHttpServer()).get(`/api/v1/r/${slug}/menu`);
    const itemId = menuRes.body[0].id;
    const place = await supertest(app.getHttpServer())
      .post(`/api/v1/r/${slug}/orders`)
      .send({ branchId, orderType: 'pickup', lines: [{ itemId, quantity: 2 }], idempotencyKey: 'rev-ord-1' });
    expect(place.status).toBe(201);

    // Order is NEW, not COMPLETE → the review endpoint rejects it (409).
    const res = await supertest(app.getHttpServer())
      .post(`/api/v1/r/${slug}/reviews`)
      .send({ orderId: place.body.id, rating: 5, comment: 'Great!' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('order_not_complete');
  });

  it('runs a diner cart end-to-end over HTTP (create → add → quote → checkout)', async () => {
    // A fresh in-stock item for the cart (the seed Falafel is still available).
    const menuRes = await supertest(app.getHttpServer()).get(`/api/v1/r/${slug}/menu`);
    expect(menuRes.status).toBe(200);
    const itemId = menuRes.body[0].id;

    const cart = await supertest(app.getHttpServer())
      .post(`/api/v1/r/${slug}/carts`)
      .send({ branchId });
    expect(cart.status).toBe(201);
    const cartId = cart.body.id;

    const add = await supertest(app.getHttpServer())
      .post(`/api/v1/r/${slug}/carts/${cartId}/items`)
      .send({ itemId, quantity: 2 });
    expect(add.status).toBe(201);

    const quote = await supertest(app.getHttpServer()).get(
      `/api/v1/r/${slug}/carts/${cartId}/quote`,
    );
    expect(quote.status).toBe(200);
    expect(quote.body.subtotalMinor).toBe(3000); // 2 × 1500

    const checkout = await supertest(app.getHttpServer())
      .post(`/api/v1/r/${slug}/carts/${cartId}/checkout`)
      .send({ branchId, orderType: 'pickup', idempotencyKey: 'cart-co-1' });
    expect(checkout.status).toBe(201);
    expect(checkout.body.status).toBe('NEW');
    expect(checkout.body.subtotalMinor).toBe(3000);
  });
});
