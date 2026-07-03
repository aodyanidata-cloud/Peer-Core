import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

/**
 * PromotionService — merchant-owned voucher/discount engine (R2 §11A). The
 * merchant defines codes; the discount is applied server-side at checkout
 * (OrderService.resolvePromo) against the structured subtotal.
 */
@Injectable()
export class PromotionService {
  constructor(private readonly tenancy: TenancyService) {}

  create(
    tenantId: string,
    input: {
      code: string;
      kind: 'percent' | 'amount';
      value: number;
      minOrderMinor?: number;
      maxRedemptions?: number;
    },
  ) {
    if (input.kind === 'percent' && (input.value < 0 || input.value > 100)) {
      throw new Error('percent value must be 0–100');
    }
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.promotions)
        .values({
          tenantId,
          code: input.code,
          kind: input.kind,
          value: input.value,
          minOrderMinor: input.minOrderMinor ?? 0,
          maxRedemptions: input.maxRedemptions ?? null,
        })
        .returning();
      return row;
    });
  }

  list(tenantId: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx.select().from(schema.promotions),
    );
  }

  deactivate(tenantId: string, id: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx
        .update(schema.promotions)
        .set({ active: false })
        .where(eq(schema.promotions.id, id)),
    );
  }
}
