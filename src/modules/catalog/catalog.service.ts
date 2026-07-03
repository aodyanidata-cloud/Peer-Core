import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../tenancy/tenancy.service';

export type ItemStatus = 'available' | 'sold_out' | 'hidden';

export interface NewItem {
  name: string;
  description?: string;
  categoryId?: string;
  priceMinor: number; // integer minor units
  currency?: string;
  attributes?: Record<string, unknown>;
  externalRef?: string;
  source?: string;
}

/**
 * CatalogService — generic, tenant-scoped catalog access (B3).
 * Every method runs inside the caller's tenant RLS context via TenancyService,
 * so cross-tenant reads/writes are impossible at the data layer. Prices are
 * integer minor units; the service never does float math on money.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly tenancy: TenancyService) {}

  async createItem(tenantId: string, input: NewItem) {
    if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) {
      throw new Error('priceMinor must be a non-negative integer (minor units)');
    }
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.catalogItems)
        .values({
          tenantId,
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId ?? null,
          priceMinor: input.priceMinor,
          currency: input.currency ?? 'SAR',
          attributes: input.attributes ?? {},
          externalRef: input.externalRef ?? null,
          source: input.source ?? null,
        })
        .returning();
      return row;
    });
  }

  listItems(tenantId: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx.select().from(schema.catalogItems),
    );
  }

  setItemStatus(tenantId: string, itemId: string, status: ItemStatus) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.catalogItems)
        .set({ status })
        .where(eq(schema.catalogItems.id, itemId))
        .returning();
      return row;
    });
  }
}
