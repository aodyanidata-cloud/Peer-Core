import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly code: 'order_not_complete' | 'not_found',
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

/**
 * ReviewService — ratings & reviews (R2 §11A/§11D). A review is allowed only
 * once an order is COMPLETE, and only one per order (DB unique constraint).
 */
@Injectable()
export class ReviewService {
  constructor(private readonly tenancy: TenancyService) {}

  submit(
    tenantId: string,
    input: { orderId: string; rating: number; comment?: string },
  ) {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new Error('rating must be an integer 1–5');
    }
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [order] = await tx
        .select({ status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.id, input.orderId))
        .limit(1);
      if (!order) throw new ReviewError('no such order', 'not_found');
      if (order.status !== 'COMPLETE') {
        throw new ReviewError('order is not complete', 'order_not_complete');
      }
      const [row] = await tx
        .insert(schema.reviews)
        .values({
          tenantId,
          orderId: input.orderId,
          rating: input.rating,
          comment: input.comment ?? null,
        })
        .returning();
      return row;
    });
  }

  async summary(
    tenantId: string,
  ): Promise<{ count: number; average: number }> {
    const rows = await this.tenancy.runAs(tenantId, (tx) =>
      tx.select({ rating: schema.reviews.rating }).from(schema.reviews),
    );
    const count = rows.length;
    const average =
      count === 0 ? 0 : rows.reduce((s, r) => s + r.rating, 0) / count;
    return { count, average };
  }
}
