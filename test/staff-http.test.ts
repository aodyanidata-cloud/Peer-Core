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

d('staff console over HTTP — auth-guarded (R2)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let token: string;
  let orderId: string;
  const ownerPhone = '+966500000009';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    await pool.query(
      'TRUNCATE sessions, otp_challenges, memberships, users, payments, order_events, order_items, orders, catalog_items, branches, tenants RESTART IDENTITY CASCADE',
    );
    const tenancy = new TenancyService();
    const { tenantId, branchId } = await new OnboardingService(
      new RestaurantService(tenancy),
    ).onboard({ name: 'Grill', slug: 'grill', ownerPhone, branchName: 'HQ' });
    const item = await new MenuService(tenancy, new CatalogService(tenancy)).createItem(
      tenantId,
      { name: 'Kebab', priceMinor: 3000 },
    );

    // Log the owner in to get a real session token.
    const cap = new CapturingOtp();
    const auth = new AuthService(db, cap);
    await auth.requestOtp(ownerPhone);
    const res = await auth.verifyOtp(ownerPhone, cap.last.get(ownerPhone)!);
    token = res.token;

    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Place the order THROUGH THE APP so the app's payment provider holds the
    // authorization that the staff accept later captures.
    const placed = await supertest(app.getHttpServer())
      .post('/api/v1/r/grill/orders')
      .send({ branchId, orderType: 'pickup', lines: [{ itemId: item.id, quantity: 1 }], idempotencyKey: 'staff-ord-1' });
    orderId = placed.body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await pool.end();
  });

  it('rejects the staff queue without a token', async () => {
    const res = await supertest(app.getHttpServer()).get('/api/v1/staff/orders');
    expect(res.status).toBe(401);
  });

  it('serves the staff queue for an authenticated owner', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/staff/orders')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(orderId);
  });

  it('accepts an order (captures payment) through the guarded endpoint', async () => {
    const res = await supertest(app.getHttpServer())
      .post(`/api/v1/staff/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACCEPTED');
    expect(res.body.paymentStatus).toBe('captured');
  });

  it('serves the console HTML shell', async () => {
    const res = await supertest(app.getHttpServer()).get('/api/v1/staff/console');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Staff Console');
  });
});
