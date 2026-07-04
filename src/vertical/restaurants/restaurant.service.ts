import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import { ValidationError } from '../../common/validation-error';

export interface NewBranch {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  hours?: Record<string, [string, string][]>;
  phone?: string;
  minOrderMinor?: number;
}

export interface BranchPatch {
  name?: string;
  address?: string;
  phone?: string;
  hours?: Record<string, [string, string][]>;
  minOrderMinor?: number;
}

export interface NewTable {
  branchId: string;
  name: string;
  capacity: number;
  area?: string;
}

/**
 * RestaurantService — branches and tables for the Restaurants vertical (R1.1).
 * Every operation runs inside the tenant RLS context.
 */
@Injectable()
export class RestaurantService {
  constructor(private readonly tenancy: TenancyService) {}

  createBranch(tenantId: string, input: NewBranch) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.branches)
        .values({
          tenantId,
          name: input.name,
          address: input.address ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          hours: input.hours ?? {},
          phone: input.phone ?? null,
          minOrderMinor: input.minOrderMinor ?? 0,
        })
        .returning();
      return row;
    });
  }

  listBranches(tenantId: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx.select().from(schema.branches),
    );
  }

  /** Update branch settings a merchant edits post-onboarding (hours, minimum order). */
  updateBranch(tenantId: string, branchId: string, patch: BranchPatch) {
    if (
      patch.minOrderMinor !== undefined &&
      (!Number.isInteger(patch.minOrderMinor) || patch.minOrderMinor < 0)
    ) {
      throw new ValidationError('minOrderMinor must be a non-negative integer (minor units)');
    }
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.branches)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.address !== undefined ? { address: patch.address } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.hours !== undefined ? { hours: patch.hours } : {}),
          ...(patch.minOrderMinor !== undefined
            ? { minOrderMinor: patch.minOrderMinor }
            : {}),
        })
        .where(eq(schema.branches.id, branchId))
        .returning();
      return row;
    });
  }

  async addTable(tenantId: string, input: NewTable) {
    if (!Number.isInteger(input.capacity) || input.capacity <= 0) {
      throw new ValidationError('table capacity must be a positive integer');
    }
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.restaurantTables)
        .values({
          tenantId,
          branchId: input.branchId,
          name: input.name,
          capacity: input.capacity,
          area: input.area ?? null,
        })
        .returning();
      return row;
    });
  }

  listTables(tenantId: string, branchId: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx
        .select()
        .from(schema.restaurantTables)
        .where(eq(schema.restaurantTables.branchId, branchId)),
    );
  }
}
