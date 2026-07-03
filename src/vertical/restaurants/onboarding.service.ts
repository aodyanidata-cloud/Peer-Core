import { Injectable } from '@nestjs/common';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { RestaurantService } from './restaurant.service';

export interface OnboardResult {
  tenantId: string;
  ownerUserId: string;
  branchId: string;
}

/**
 * OnboardingService — stand up a new restaurant tenant (R1.13). Creates the
 * tenant, the owner user + owner membership (so B2 auth can then authorize them),
 * and a first branch. Ties tenancy (B1) and auth (B2) together. This is an
 * admin-plane operation (tenant creation), not a tenant-scoped request.
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly restaurants: RestaurantService) {}

  async onboard(input: {
    name: string;
    slug: string;
    ownerPhone: string;
    branchName: string;
  }): Promise<OnboardResult> {
    const db = getDb();
    // Admin-plane inserts (tenants/users/memberships are not tenant-scoped tables).
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: input.name, slug: input.slug })
      .returning({ id: schema.tenants.id });

    const [owner] = await db
      .insert(schema.users)
      .values({ phone: input.ownerPhone })
      .onConflictDoUpdate({
        target: schema.users.phone,
        set: { phone: input.ownerPhone },
      })
      .returning({ id: schema.users.id });

    await db.insert(schema.memberships).values({
      userId: owner.id,
      tenantId: tenant.id,
      role: 'owner',
    });

    const branch = await this.restaurants.createBranch(tenant.id, {
      name: input.branchName,
    });

    return { tenantId: tenant.id, ownerUserId: owner.id, branchId: branch.id };
  }
}
