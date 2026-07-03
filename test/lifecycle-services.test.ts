import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { ComplaintService } from '../src/vertical/restaurants/complaint.service';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { LoggingSmsProvider } from '../src/modules/channels/logging-adapters';
import { WhatsAppProvider } from '../src/modules/channels/whatsapp-provider';
import { OnboardingService } from '../src/vertical/restaurants/onboarding.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import { AuthService } from '../src/modules/identity/auth.service';
import { LoggingOtpSender } from '../src/modules/identity/otp-sender';
import { closeDb } from '../src/db';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('lifecycle services (R1.9/R1.10/R1.11/R1.13)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let tenancy: TenancyService;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    tenancy = new TenancyService();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE notifications, notification_optouts, complaints, memberships, users, branches, tenants RESTART IDENTITY CASCADE',
    );
    await db.insert(schema.tenants).values([
      { id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' },
      { id: tenantB, slug: 'b-' + tenantB.slice(0, 8), name: 'B' },
    ]);
  });

  afterAll(async () => {
    await closeDb();
    await pool.end();
  });

  it('captures a complaint and keeps it tenant-scoped (R1.9)', async () => {
    const svc = new ComplaintService(tenancy);
    await svc.capture(tenantA, { subject: 'cold food', body: 'the soup was cold' });
    const openA = await svc.listOpen(tenantA);
    expect(openA).toHaveLength(1);
    const openB = await svc.listOpen(tenantB);
    expect(openB).toHaveLength(0); // tenant B never sees A's complaint
  });

  it('notifies once, dedupes, and respects opt-out (R1.10/R1.11)', async () => {
    const sms = new LoggingSmsProvider();
    const wa = new WhatsAppProvider();
    const notif = new NotificationService(tenancy, sms, wa);

    const first = await notif.notify(tenantA, {
      recipient: '+966500000001',
      channel: 'whatsapp',
      event: 'reservation_confirmed',
      body: 'Booked!',
      dedupeKey: 'res-1',
    });
    expect(first.status).toBe('sent');
    expect(wa.sent).toHaveLength(1);

    const dup = await notif.notify(tenantA, {
      recipient: '+966500000001',
      channel: 'whatsapp',
      event: 'reservation_confirmed',
      body: 'Booked!',
      dedupeKey: 'res-1',
    });
    expect(dup.status).toBe('deduped');
    expect(wa.sent).toHaveLength(1); // not sent again

    await notif.optOut(tenantA, '+966500000002', 'sms');
    const blocked = await notif.notify(tenantA, {
      recipient: '+966500000002',
      channel: 'sms',
      event: 'promo',
      body: 'hi',
    });
    expect(blocked.status).toBe('opted_out');
    expect(sms.sent).toHaveLength(0);
  });

  it('onboards a new restaurant with an owner membership (R1.13)', async () => {
    const onboarding = new OnboardingService(new RestaurantService(tenancy));
    const res = await onboarding.onboard({
      name: 'Test Eatery',
      slug: 'test-eatery',
      ownerPhone: '+966500000009',
      branchName: 'HQ',
    });

    // The owner can now be authorized for the new tenant via B2 auth.
    const auth = new AuthService(db, new LoggingOtpSender());
    await auth.requestOtp('+966500000009');
    // Simulate a verified session by loading the context through a fresh login is
    // out of scope here; assert the membership exists and grants owner authority.
    const memberships = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.tenantId, res.tenantId));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');
    const ctx = { userId: res.ownerUserId, phone: '+966500000009', memberships: [{ tenantId: res.tenantId, role: 'owner' as const }] };
    expect(auth.authorizeTenant(ctx, res.tenantId, ['owner'])).toBe(res.tenantId);
  });
});
