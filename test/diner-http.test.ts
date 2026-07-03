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

d('diner web widget HTTP (R1.12)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const slug = 'test-eatery';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    await pool.query('TRUNCATE catalog_items, branches, memberships, users, tenants RESTART IDENTITY CASCADE');

    const tenancy = new TenancyService();
    const onboarding = new OnboardingService(new RestaurantService(tenancy));
    const { tenantId } = await onboarding.onboard({
      name: 'Test Eatery',
      slug,
      ownerPhone: '+966500000009',
      branchName: 'HQ',
    });
    const menu = new MenuService(tenancy, new CatalogService(tenancy));
    await menu.createItem(tenantId, { name: 'Falafel Wrap', priceMinor: 1500 });

    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await pool.end();
  });

  it('serves a tenant menu resolved from the public slug', async () => {
    const res = await supertest(app.getHttpServer()).get(
      `/api/v1/r/${slug}/menu?q=falafel`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Falafel Wrap');
  });

  it('returns 404 for an unknown restaurant slug', async () => {
    const res = await supertest(app.getHttpServer()).get(
      '/api/v1/r/no-such-place/menu',
    );
    expect(res.status).toBe(404);
  });

  it('serves the HTML widget', async () => {
    const res = await supertest(app.getHttpServer()).get(
      `/api/v1/r/${slug}/widget`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<title>Menu</title>');
  });
});
