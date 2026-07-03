import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { Pool } from 'pg';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/main';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OnboardingService } from '../src/vertical/restaurants/onboarding.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import { MenuService } from '../src/vertical/restaurants/menu.service';
import { closeDb } from '../src/db';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('order flow over HTTP (R2)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const slug = 'flow-eatery';
  let branchId: string;
  let itemId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    await pool.query(
      'TRUNCATE orders, catalog_items, branches, memberships, users, tenants RESTART IDENTITY CASCADE',
    );
    const tenancy = new TenancyService();
    const onboarding = new OnboardingService(new RestaurantService(tenancy));
    const { tenantId, branchId: b } = await onboarding.onboard({
      name: 'Flow Eatery',
      slug,
      ownerPhone: '+966500000009',
      branchName: 'HQ',
    });
    branchId = b;
    const menu = new MenuService(tenancy, new CatalogService(tenancy));
    const item = await menu.createItem(tenantId, { name: 'Mixed Grill', priceMinor: 3500 });
    itemId = item.id;

    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await pool.end();
  });

  it('places an order and then tracks it, with server-side totals', async () => {
    const place = await supertest(app.getHttpServer())
      .post(`/api/v1/r/${slug}/orders`)
      .send({ branchId, orderType: 'pickup', lines: [{ itemId, quantity: 2 }], dinerPhone: '+966511111111' });
    expect(place.status).toBe(201);
    expect(place.body.status).toBe('NEW');
    expect(place.body.subtotalMinor).toBe(7000); // 2 x 3500, server-computed
    expect(place.body.totalMinor).toBe(8050); // + 15% VAT

    const orderId = place.body.id;
    const track = await supertest(app.getHttpServer()).get(
      `/api/v1/r/${slug}/orders/${orderId}`,
    );
    expect(track.status).toBe(200);
    expect(track.body.order.id).toBe(orderId);
    expect(track.body.items).toHaveLength(1);
    expect(track.body.events[0].toStatus).toBe('NEW');
  });
});
