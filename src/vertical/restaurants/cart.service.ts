import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import { OrderService, type CheckoutLine } from './order.service';

/**
 * CartService — persistent cart for the diner (R2.1). Totals are always a live
 * server-side quote from the catalog (never stored/trusted), and checkout hands
 * the lines to OrderService so the money path stays single-sourced.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly orders: OrderService,
  ) {}

  createCart(tenantId: string, branchId: string) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [cart] = await tx
        .insert(schema.carts)
        .values({ tenantId, branchId })
        .returning();
      return cart;
    });
  }

  addItem(
    tenantId: string,
    cartId: string,
    line: CheckoutLine,
  ) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.cartItems)
        .values({
          tenantId,
          cartId,
          itemId: line.itemId,
          quantity: line.quantity,
          modifiers: line.modifiers ?? [],
        })
        .returning();
      return row;
    });
  }

  private async lines(tenantId: string, cartId: string): Promise<CheckoutLine[]> {
    const items = await this.tenancy.runAs(tenantId, (tx) =>
      tx.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cartId)),
    );
    return items.map((i) => ({
      itemId: i.itemId,
      quantity: i.quantity,
      modifiers: (i.modifiers ?? []) as { group: string; option: string }[],
    }));
  }

  /** Live totals for the current cart (server-side; nothing trusted from client). */
  async quote(tenantId: string, cartId: string, deliveryFeeMinor = 0) {
    return this.orders.quote(tenantId, await this.lines(tenantId, cartId), deliveryFeeMinor);
  }

  /** Turn the cart into an order via the single money path, then close the cart. */
  async checkout(
    tenantId: string,
    cartId: string,
    opts: {
      branchId: string;
      orderType: 'delivery' | 'pickup' | 'dinein';
      dinerPhone?: string;
      idempotencyKey?: string;
      deliveryFeeMinor?: number;
    },
  ) {
    const order = await this.orders.checkout(tenantId, {
      branchId: opts.branchId,
      orderType: opts.orderType,
      lines: await this.lines(tenantId, cartId),
      ...(opts.deliveryFeeMinor !== undefined
        ? { deliveryFeeMinor: opts.deliveryFeeMinor }
        : {}),
      ...(opts.dinerPhone !== undefined ? { dinerPhone: opts.dinerPhone } : {}),
      ...(opts.idempotencyKey !== undefined
        ? { idempotencyKey: opts.idempotencyKey }
        : {}),
    });
    await this.tenancy.runAs(tenantId, (tx) =>
      tx
        .update(schema.carts)
        .set({ status: 'checked_out' })
        .where(eq(schema.carts.id, cartId)),
    );
    return order;
  }
}
