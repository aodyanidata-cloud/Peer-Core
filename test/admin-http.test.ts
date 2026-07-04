import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as schema from '../src/db/schema';
import { createApp } from '../src/main';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { OnboardingService } from '../src/vertical/restaurants/onboarding.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
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
 * Admin portal + login over HTTP. Proves: the login flow mints a real token; the
 * AdminGuard rejects no-token (401) and non-admin tokens (403); and a platform
 * admin can list/create/suspend restaurants and read the platform overview.
 */
d('admin portal + auth login over HTTP', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let cap: CapturingOtp;
  let auth: AuthService;
  let adminToken: string;
  let ownerToken: string;
  const adminPhone = '+966500000001';
  const ownerPhone = '+966500000031';

  const login = async (phone: string): Promise<string> => {
    await auth.requestOtp(phone);
    const res = await auth.verifyOtp(phone, cap.last.get(phone)!);
    return res.token;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    await pool.query(
      'TRUNCATE platform_admins, sessions, otp_challenges, memberships, users, payments, order_events, order_items, orders, catalog_items, branches, tenants RESTART IDENTITY CASCADE',
    );
    cap = new CapturingOtp();
    auth = new AuthService(db, cap);

    // A platform admin, and a plain restaurant owner (non-admin).
    await auth.grantPlatformAdmin(adminPhone);
    await new OnboardingService(new RestaurantService(new TenancyService())).onboard({
      name: 'Owned Grill',
      slug: 'owned-grill',
      ownerPhone,
      branchName: 'HQ',
    });

    adminToken = await login(adminPhone);
    ownerToken = await login(ownerPhone);

    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await pool.end();
  });

  const bearer = (r: supertest.Test, t: string) => r.set('Authorization', `Bearer ${t}`);

  it('serves the sign-in page and admin console shell', async () => {
    const login = await supertest(app.getHttpServer()).get('/api/v1/auth/login');
    expect(login.status).toBe(200);
    expect(login.text).toContain('Sign in');
    const console = await supertest(app.getHttpServer()).get('/api/v1/admin/console');
    expect(console.status).toBe(200);
    expect(console.text).toContain('Admin');
  });

  it('logs in over HTTP and reports platform-admin status', async () => {
    await auth.requestOtp(adminPhone);
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ phone: adminPhone, code: cap.last.get(adminPhone) });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.isPlatformAdmin).toBe(true);
  });

  it('guards admin routes: 401 without a token', async () => {
    const res = await supertest(app.getHttpServer()).get('/api/v1/admin/tenants');
    expect(res.status).toBe(401);
  });

  it('guards admin routes: 403 for a non-admin (owner) token', async () => {
    const res = await bearer(
      supertest(app.getHttpServer()).get('/api/v1/admin/tenants'),
      ownerToken,
    );
    expect(res.status).toBe(403);
  });

  it('lets a platform admin see the overview and every restaurant', async () => {
    const overview = await bearer(
      supertest(app.getHttpServer()).get('/api/v1/admin/overview'),
      adminToken,
    );
    expect(overview.status).toBe(200);
    expect(overview.body.paymentProvider).toBe('fake');
    expect(overview.body.tenantCount).toBeGreaterThanOrEqual(1);
    expect(overview.body.verticals[0].key).toBe('restaurants');

    const list = await bearer(
      supertest(app.getHttpServer()).get('/api/v1/admin/tenants'),
      adminToken,
    );
    expect(list.status).toBe(200);
    expect(list.body.some((t: { slug: string }) => t.slug === 'owned-grill')).toBe(true);
  });

  it('creates and suspends a restaurant through the admin portal', async () => {
    const created = await bearer(
      supertest(app.getHttpServer()).post('/api/v1/admin/tenants'),
      adminToken,
    ).send({ name: 'New Spot', slug: 'new-spot', ownerPhone: '+966500000099', branchName: 'Main' });
    expect(created.status).toBe(201);
    expect(created.body.tenantId).toBeTruthy();

    const suspended = await bearer(
      supertest(app.getHttpServer()).post(`/api/v1/admin/tenants/${created.body.tenantId}/status`),
      adminToken,
    ).send({ status: 'suspended' });
    expect(suspended.status).toBe(201);
    expect(suspended.body.status).toBe('suspended');
  });
});
