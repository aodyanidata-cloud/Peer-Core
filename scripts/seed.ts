import { eq } from 'drizzle-orm';
import { loadDotEnv } from '../src/load-env';
import { getDb, closeDb } from '../src/db';
import * as schema from '../src/db/schema';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { RestaurantService } from '../src/vertical/restaurants/restaurant.service';
import { MenuService } from '../src/vertical/restaurants/menu.service';
import { OnboardingService } from '../src/vertical/restaurants/onboarding.service';
import { OrderService } from '../src/vertical/restaurants/order.service';
import { FakePaymentProvider } from '../src/modules/payments/fake-payment-provider';

/**
 * Demo seed — stand up one restaurant with a menu and a couple of live orders so
 * the diner widget and staff console have something to show immediately after a
 * fresh `db:migrate`. Idempotent: if the demo restaurant already exists, it does
 * nothing. Uses the offline fake payment provider (no real money).
 */
const SLUG = 'demo-grill';
const OWNER_PHONE = '+966500000000';

async function main(): Promise<void> {
  loadDotEnv();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const db = getDb();
  const existing = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, SLUG))
    .limit(1);
  if (existing.length > 0) {
    console.log(`Demo restaurant "${SLUG}" already seeded — nothing to do.`);
    await closeDb();
    return;
  }

  const tenancy = new TenancyService();
  const restaurants = new RestaurantService(tenancy);
  const menu = new MenuService(tenancy, new CatalogService(tenancy));
  const onboarding = new OnboardingService(restaurants);
  const orders = new OrderService(tenancy, new FakePaymentProvider());

  const { tenantId, branchId } = await onboarding.onboard({
    name: 'Demo Grill',
    slug: SLUG,
    ownerPhone: OWNER_PHONE,
    branchName: 'Downtown',
  });

  // Open every day, all hours, so "order now" is never blocked by the hours guard.
  const hours: Record<string, [string, string][]> = Object.fromEntries(
    ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [
      d,
      [['00:00', '23:59']],
    ]),
  );
  await restaurants.updateBranch(tenantId, branchId, { hours, minOrderMinor: 0 });

  const shawarma = await menu.createItem(tenantId, {
    name: 'Chicken Shawarma',
    description: 'Grilled chicken, garlic sauce, pickles in warm bread.',
    priceMinor: 1800,
  });
  await menu.createItem(tenantId, {
    name: 'Falafel Wrap',
    description: 'Crispy falafel, tahini, salad.',
    priceMinor: 1200,
  });
  await menu.createItem(tenantId, {
    name: 'Mixed Grill Platter',
    description: 'Kebab, tikka, and kofta with rice.',
    priceMinor: 4500,
    modifierGroups: [
      {
        name: 'Size',
        minSelect: 1,
        maxSelect: 1,
        required: true,
        options: [
          { name: 'Regular', priceDeltaMinor: 0 },
          { name: 'Large', priceDeltaMinor: 800 },
        ],
      },
    ],
  });
  await menu.createItem(tenantId, {
    name: 'Fresh Orange Juice',
    description: 'Freshly squeezed.',
    priceMinor: 900,
  });

  // A couple of live orders so the staff queue isn't empty.
  await orders.checkout(tenantId, {
    branchId,
    orderType: 'pickup',
    lines: [{ itemId: shawarma.id, quantity: 2 }],
    dinerPhone: '+966511111111',
    idempotencyKey: 'seed-order-1',
  });
  await orders.checkout(tenantId, {
    branchId,
    orderType: 'delivery',
    lines: [{ itemId: shawarma.id, quantity: 1 }],
    dinerPhone: '+966522222222',
    idempotencyKey: 'seed-order-2',
  });

  await closeDb();

  console.log(`
Seeded demo restaurant "Demo Grill".

  Diner menu widget : /api/v1/r/${SLUG}/widget
  Staff console     : /api/v1/staff/console
  Owner login phone : ${OWNER_PHONE}

Two pickup/delivery orders are waiting in the staff queue.
To sign in to the console, request an OTP for the owner phone — with no SMS
provider wired locally, the code is printed to the server logs.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
