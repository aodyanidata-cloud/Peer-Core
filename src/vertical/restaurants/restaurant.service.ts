import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

export interface NewBranch {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  hours?: Record<string, [string, string][]>;
  phone?: string;
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

  async addTable(tenantId: string, input: NewTable) {
    if (!Number.isInteger(input.capacity) || input.capacity <= 0) {
      throw new Error('table capacity must be a positive integer');
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
