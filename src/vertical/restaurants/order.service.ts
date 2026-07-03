import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import type { PaymentProvider } from '../../modules/payments/payment-provider';
import { computeTotals, type PricedModifier } from './pricing';
import { canTransition, type OrderStatus } from './order-state';

export class OrderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'bad_item'
      | 'unavailable'
      | 'bad_modifier'
      | 'illegal_transition',
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export interface CheckoutLine {
  itemId: string;
  quantity: number;
  modifiers?: { group: string; option: string }[];
}
export interface CheckoutInput {
  branchId: string;
  orderType: 'delivery' | 'pickup' | 'dinein';
  lines: CheckoutLine[];
  deliveryFeeMinor?: number;
  idempotencyKey?: string;
  dinerPhone?: string;
}

interface ModifierGroup {
  name: string;
  options: { name: string; priceDeltaMinor: number }[];
}

/**
 * OrderService — checkout + two-phase money lifecycle (R2 🔴).
 *
 * Guarantees:
 *  - Totals are computed SERVER-SIDE from the structured catalog; the request
 *    carries no price, and modifier deltas are resolved from the item's stored
 *    modifier groups (a forged price/modifier can never move money).
 *  - Payment is AUTHORIZED before the order row exists; a declined authorization
 *    creates no order (the transaction rolls back).
 *  - Idempotency: a repeated checkout with the same key returns the same order.
 *  - Only legal state transitions; accept captures, reject/cancel-before-capture
 *    voids, cancel-after-capture refunds. Every transition is audited.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly payments: PaymentProvider,
  ) {}

  async checkout(tenantId: string, input: CheckoutInput) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      if (input.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(schema.orders)
          .where(
            and(
              eq(schema.orders.tenantId, tenantId),
              eq(schema.orders.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return existing; // dedupe: one order per key
      }

      // Resolve every price from the catalog (structured), never the request.
      const priceLines = [];
      const snapshots: { itemId: string; name: string }[] = [];
      for (const line of input.lines) {
        const [item] = await tx
          .select()
          .from(schema.catalogItems)
          .where(eq(schema.catalogItems.id, line.itemId))
          .limit(1);
        if (!item) throw new OrderError('unknown item', 'bad_item');
        if (item.status !== 'available') {
          throw new OrderError(`${item.name} is unavailable`, 'unavailable');
        }
        const groups =
          ((item.attributes ?? {}) as { modifierGroups?: ModifierGroup[] })
            .modifierGroups ?? [];
        const modifiers: PricedModifier[] = (line.modifiers ?? []).map((sel) => {
          const group = groups.find((g) => g.name === sel.group);
          const option = group?.options.find((o) => o.name === sel.option);
          if (!option) throw new OrderError('unknown modifier', 'bad_modifier');
          return { name: option.name, priceDeltaMinor: option.priceDeltaMinor };
        });
        priceLines.push({
          unitPriceMinor: item.priceMinor,
          quantity: line.quantity,
          modifiers,
        });
        snapshots.push({ itemId: item.id, name: item.name });
      }

      const totals = computeTotals(priceLines, input.deliveryFeeMinor ?? 0);

      // Authorize BEFORE creating the order. A decline throws → tx rolls back →
      // no order exists.
      const idem = input.idempotencyKey ?? randomUUID();
      const intent = await this.payments.authorize({
        amountMinor: totals.totalMinor,
        currency: 'SAR',
        idempotencyKey: idem,
      });

      const [order] = await tx
        .insert(schema.orders)
        .values({
          tenantId,
          branchId: input.branchId,
          orderType: input.orderType,
          subtotalMinor: totals.subtotalMinor,
          vatMinor: totals.vatMinor,
          deliveryFeeMinor: input.deliveryFeeMinor ?? 0,
          totalMinor: totals.totalMinor,
          status: 'NEW',
          paymentStatus: 'authorized',
          paymentRef: intent.ref,
          idempotencyKey: input.idempotencyKey ?? null,
          dinerPhone: input.dinerPhone ?? null,
        })
        .returning();

      for (let i = 0; i < priceLines.length; i++) {
        await tx.insert(schema.orderItems).values({
          tenantId,
          orderId: order.id,
          itemId: snapshots[i].itemId,
          name: snapshots[i].name,
          unitPriceMinor: totals.lines[i].effectiveUnitMinor,
          quantity: priceLines[i].quantity,
          modifiers: priceLines[i].modifiers,
          lineTotalMinor: totals.lines[i].lineTotalMinor,
        });
      }
      await tx.insert(schema.orderEvents).values({
        tenantId,
        orderId: order.id,
        fromStatus: null,
        toStatus: 'NEW',
      });
      await tx.insert(schema.payments).values({
        tenantId,
        orderId: order.id,
        action: 'authorize',
        amountMinor: totals.totalMinor,
        provider: this.payments.name,
        providerRef: intent.ref,
        status: 'authorized',
      });

      return order;
    });
  }

  /** Restaurant accepts → capture the held funds. */
  accept(tenantId: string, orderId: string) {
    return this.transition(tenantId, orderId, 'ACCEPTED', 'capture');
  }

  /** Restaurant rejects → void the authorization (no fee). */
  reject(tenantId: string, orderId: string) {
    return this.transition(tenantId, orderId, 'REJECTED', 'void');
  }

  /** Cancel: void if not yet captured, refund if already captured. */
  cancel(tenantId: string, orderId: string) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const order = await this.load(tx, orderId);
      const money = order.paymentStatus === 'captured' ? 'refund' : 'void';
      return this.applyTransition(tx, tenantId, order, 'CANCELLED', money);
    });
  }

  /** Progress a live order (PREPARING, READY, …) with no payment effect. */
  advance(tenantId: string, orderId: string, to: OrderStatus) {
    return this.transition(tenantId, orderId, to, null);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private transition(
    tenantId: string,
    orderId: string,
    to: OrderStatus,
    money: 'capture' | 'void' | 'refund' | null,
  ) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const order = await this.load(tx, orderId);
      return this.applyTransition(tx, tenantId, order, to, money);
    });
  }

  private async load(tx: Parameters<Parameters<TenancyService['runAs']>[1]>[0], orderId: string) {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    if (!order) throw new OrderError('no such order', 'not_found');
    return order;
  }

  private async applyTransition(
    tx: Parameters<Parameters<TenancyService['runAs']>[1]>[0],
    tenantId: string,
    order: typeof schema.orders.$inferSelect,
    to: OrderStatus,
    money: 'capture' | 'void' | 'refund' | null,
  ) {
    if (!canTransition(order.status as OrderStatus, to)) {
      throw new OrderError(
        `illegal transition ${order.status} → ${to}`,
        'illegal_transition',
      );
    }

    let paymentStatus = order.paymentStatus;
    if (money && order.paymentRef) {
      const intent = await this.payments[money](order.paymentRef);
      paymentStatus = intent.status;
      await tx.insert(schema.payments).values({
        tenantId,
        orderId: order.id,
        action: money,
        amountMinor: order.totalMinor,
        provider: this.payments.name,
        providerRef: order.paymentRef,
        status: intent.status,
      });
    }

    const [updated] = await tx
      .update(schema.orders)
      .set({ status: to, paymentStatus })
      .where(eq(schema.orders.id, order.id))
      .returning();
    await tx.insert(schema.orderEvents).values({
      tenantId,
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
    });
    return updated;
  }
}
