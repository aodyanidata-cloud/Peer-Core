import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import type { PaymentProvider } from '../../modules/payments/payment-provider';
import { computeTotals, type PricedModifier } from './pricing';
import { canTransition, type OrderStatus } from './order-state';

/** Minimal notifier seam so orders can proactively update the diner (R2 tracking). */
export interface OrderNotifier {
  notify(
    tenantId: string,
    input: {
      recipient: string;
      channel: 'sms' | 'whatsapp';
      event: string;
      body: string;
      dedupeKey?: string;
    },
  ): Promise<unknown>;
}

const NOTIFY_ON: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'Your order is confirmed and being prepared.',
  READY: 'Your order is ready.',
  OUT_FOR_DELIVERY: 'Your order is on the way.',
  DELIVERED: 'Your order has been delivered. Enjoy!',
  REJECTED: 'Sorry — the restaurant could not accept your order; you have not been charged.',
  CANCELLED: 'Your order was cancelled.',
};

export class OrderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'bad_item'
      | 'unavailable'
      | 'bad_modifier'
      | 'bad_promo'
      | 'below_minimum'
      | 'closed'
      | 'bad_schedule'
      | 'conflict'
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
  source?: Record<string, unknown>; // gateway payment token (real PSP); fake ignores
  promoCode?: string; // optional voucher/promotion code
  scheduledFor?: Date; // optional advance-order time (§11A)
}

interface ModifierGroup {
  name: string;
  minSelect?: number;
  maxSelect?: number;
  required?: boolean;
  options: { name: string; priceDeltaMinor: number }[];
}

/** Windows are [ "HH:MM", "HH:MM" ] per lowercase weekday. */
type Hours = Record<string, [string, string][]>;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Branch hours are merchant-entered LOCAL wall-clock times. The platform is
// KSA-only (Asia/Riyadh = UTC+3, no DST), so evaluate the guard in that offset
// rather than UTC — otherwise every branch's hours are wrong by 3 hours.
const BRANCH_TZ_OFFSET_MIN = 180;

function isOpenAt(hours: Hours, at: Date, offsetMinutes = BRANCH_TZ_OFFSET_MIN): boolean {
  // Shift the instant by the branch offset, then read UTC fields → local wall-clock.
  const local = new Date(at.getTime() + offsetMinutes * 60_000);
  const day = WEEKDAYS[local.getUTCDay()];
  const windows = hours[day];
  if (!windows || windows.length === 0) return false;
  const hhmm = `${String(local.getUTCHours()).padStart(2, '0')}:${String(
    local.getUTCMinutes(),
  ).padStart(2, '0')}`;
  return windows.some(([open, close]) =>
    close > open ? hhmm >= open && hhmm < close : hhmm >= open || hhmm < close,
  );
}

const SCHEDULE_HORIZON_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

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
    private readonly notifier?: OrderNotifier,
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

      if (input.lines.length === 0) {
        throw new OrderError('cannot place an empty order', 'bad_item');
      }
      const { priceLines, snapshots } = await this.resolveLines(
        tx,
        input.lines,
        input.branchId,
      );
      const deliveryFee = input.deliveryFeeMinor ?? 0;
      const base = computeTotals(priceLines, deliveryFee, 0);

      // ── Checkout guardrails (BRD §6.3) ──────────────────────────────────
      const [branch] = await tx
        .select({
          hours: schema.branches.hours,
          minOrderMinor: schema.branches.minOrderMinor,
        })
        .from(schema.branches)
        .where(eq(schema.branches.id, input.branchId))
        .limit(1);
      if (!branch) throw new OrderError('unknown branch', 'bad_item');

      if (base.subtotalMinor < branch.minOrderMinor) {
        throw new OrderError('order is below the branch minimum', 'below_minimum');
      }
      const nowMs = Date.now();
      if (input.scheduledFor) {
        const t = input.scheduledFor.getTime();
        if (t < nowMs - 60_000) {
          throw new OrderError('scheduled time is in the past', 'bad_schedule');
        }
        if (t > nowMs + SCHEDULE_HORIZON_MS) {
          throw new OrderError('scheduled time is too far out', 'bad_schedule');
        }
      }
      const when = input.scheduledFor ?? new Date();
      const hours = (branch.hours ?? {}) as Hours;
      if (Object.keys(hours).length > 0 && !isOpenAt(hours, when)) {
        throw new OrderError('the branch is closed at that time', 'closed');
      }

      // Resolve a promotion (if any) against the server-computed subtotal.
      let discountMinor = 0;
      let promoCode: string | null = null;
      if (input.promoCode) {
        const promo = await this.resolvePromo(
          tx,
          tenantId,
          input.promoCode,
          base.subtotalMinor,
        );
        discountMinor = promo.discountMinor;
        promoCode = promo.code;
      }

      const totals = computeTotals(priceLines, deliveryFee, discountMinor);

      // Authorize BEFORE creating the order. A decline throws → tx rolls back →
      // no order exists.
      const idem = input.idempotencyKey ?? randomUUID();
      const intent = await this.payments.authorize({
        amountMinor: totals.totalMinor,
        currency: 'SAR',
        idempotencyKey: idem,
        ...(input.source !== undefined ? { source: input.source } : {}),
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
          discountMinor: totals.discountMinor,
          promotionCode: promoCode,
          scheduledFor: input.scheduledFor ?? null,
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
  async cancel(tenantId: string, orderId: string) {
    const updated = await this.tenancy.runAs(tenantId, async (tx) => {
      const order = await this.load(tx, orderId);
      const money = order.paymentStatus === 'captured' ? 'refund' : 'void';
      return this.applyTransition(tx, tenantId, order, 'CANCELLED', money);
    });
    await this.maybeNotify(tenantId, updated);
    return updated;
  }

  /** Progress a live order (PREPARING, READY, …) with no payment effect. */
  advance(tenantId: string, orderId: string, to: OrderStatus) {
    return this.transition(tenantId, orderId, to, null);
  }

  /** Diner-facing tracking: the order plus its line items and status history. */
  getOrder(tenantId: string, orderId: string) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1);
      if (!order) return null;
      const items = await tx
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, orderId));
      const events = await tx
        .select()
        .from(schema.orderEvents)
        .where(eq(schema.orderEvents.orderId, orderId));
      return { order, items, events };
    });
  }

  /** Staff queue: all open (non-terminal) orders for the tenant, oldest first. */
  queue(tenantId: string) {
    const OPEN: OrderStatus[] = [
      'NEW',
      'ACCEPTED',
      'PREPARING',
      'READY',
      'OUT_FOR_DELIVERY',
    ];
    return this.tenancy.runAs(tenantId, async (tx) => {
      const rows = await tx.select().from(schema.orders);
      return rows
        .filter((r) => OPEN.includes(r.status as OrderStatus))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    });
  }

  /** Staff order queue: orders for a branch, optionally filtered by status. */
  listForBranch(tenantId: string, branchId: string, statuses?: OrderStatus[]) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.branchId, branchId));
      return statuses
        ? rows.filter((r) => statuses.includes(r.status as OrderStatus))
        : rows;
    });
  }

  /** Price a set of lines server-side without creating an order (cart preview). */
  quote(tenantId: string, lines: CheckoutLine[], deliveryFeeMinor = 0) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const { priceLines } = await this.resolveLines(tx, lines);
      return computeTotals(priceLines, deliveryFeeMinor);
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Resolve line items to catalog-sourced prices + modifier deltas. Shared by checkout and quote. */
  private async resolveLines(
    tx: Parameters<Parameters<TenancyService['runAs']>[1]>[0],
    lines: CheckoutLine[],
    branchId?: string,
  ) {
    const priceLines = [];
    const snapshots: { itemId: string; name: string }[] = [];
    for (const line of lines) {
      const [item] = await tx
        .select()
        .from(schema.catalogItems)
        .where(eq(schema.catalogItems.id, line.itemId))
        .limit(1);
      if (!item) throw new OrderError('unknown item', 'bad_item');
      if (item.status !== 'available') {
        throw new OrderError(`${item.name} is unavailable`, 'unavailable');
      }
      // Per-branch "86": an explicit availability override to false at this
      // branch gates ordering even when the item is globally available.
      if (branchId) {
        const [override] = await tx
          .select({ available: schema.menuAvailability.available })
          .from(schema.menuAvailability)
          .where(
            and(
              eq(schema.menuAvailability.itemId, line.itemId),
              eq(schema.menuAvailability.branchId, branchId),
            ),
          )
          .limit(1);
        if (override && !override.available) {
          throw new OrderError(`${item.name} is unavailable at this branch`, 'unavailable');
        }
      }
      const groups =
        ((item.attributes ?? {}) as { modifierGroups?: ModifierGroup[] })
          .modifierGroups ?? [];
      const countByGroup = new Map<string, number>();
      const modifiers: PricedModifier[] = (line.modifiers ?? []).map((sel) => {
        const group = groups.find((g) => g.name === sel.group);
        const option = group?.options.find((o) => o.name === sel.option);
        if (!option) throw new OrderError('unknown modifier', 'bad_modifier');
        countByGroup.set(sel.group, (countByGroup.get(sel.group) ?? 0) + 1);
        return { name: option.name, priceDeltaMinor: option.priceDeltaMinor };
      });
      // Enforce each group's min/max/required at ORDER time (not just authoring).
      for (const g of groups) {
        const n = countByGroup.get(g.name) ?? 0;
        const min = g.required ? Math.max(1, g.minSelect ?? 0) : g.minSelect ?? 0;
        const max = g.maxSelect ?? g.options.length;
        if (n < min) {
          throw new OrderError(
            `"${item.name}": choose at least ${min} from "${g.name}"`,
            'bad_modifier',
          );
        }
        if (n > max) {
          throw new OrderError(
            `"${item.name}": choose at most ${max} from "${g.name}"`,
            'bad_modifier',
          );
        }
      }
      priceLines.push({
        unitPriceMinor: item.priceMinor,
        quantity: line.quantity,
        modifiers,
      });
      snapshots.push({ itemId: item.id, name: item.name });
    }
    return { priceLines, snapshots };
  }

  /** Validate a promo against the server subtotal, compute the discount, redeem it. */
  private async resolvePromo(
    tx: Parameters<Parameters<TenancyService['runAs']>[1]>[0],
    tenantId: string,
    code: string,
    subtotalMinor: number,
  ): Promise<{ discountMinor: number; code: string }> {
    const [promo] = await tx
      .select()
      .from(schema.promotions)
      .where(
        and(
          eq(schema.promotions.tenantId, tenantId),
          eq(schema.promotions.code, code),
        ),
      )
      .limit(1);
    if (!promo || !promo.active) {
      throw new OrderError('invalid promo code', 'bad_promo');
    }
    if (subtotalMinor < promo.minOrderMinor) {
      throw new OrderError('order below promo minimum', 'bad_promo');
    }
    if (
      promo.maxRedemptions !== null &&
      promo.redeemedCount >= promo.maxRedemptions
    ) {
      throw new OrderError('promo fully redeemed', 'bad_promo');
    }
    const discountMinor =
      promo.kind === 'percent'
        ? Math.round((subtotalMinor * promo.value) / 100)
        : Math.min(promo.value, subtotalMinor);
    await tx
      .update(schema.promotions)
      .set({ redeemedCount: promo.redeemedCount + 1 })
      .where(eq(schema.promotions.id, promo.id));
    return { discountMinor, code: promo.code };
  }

  private async transition(
    tenantId: string,
    orderId: string,
    to: OrderStatus,
    money: 'capture' | 'void' | 'refund' | null,
  ) {
    const updated = await this.tenancy.runAs(tenantId, async (tx) => {
      const order = await this.load(tx, orderId);
      return this.applyTransition(tx, tenantId, order, to, money);
    });
    await this.maybeNotify(tenantId, updated);
    return updated;
  }

  private async maybeNotify(
    tenantId: string,
    order: typeof schema.orders.$inferSelect,
  ): Promise<void> {
    const body = NOTIFY_ON[order.status as OrderStatus];
    if (this.notifier && body && order.dinerPhone) {
      await this.notifier.notify(tenantId, {
        recipient: order.dinerPhone,
        channel: 'whatsapp',
        event: `order_${order.status}`,
        body,
        dedupeKey: `${order.id}:${order.status}`,
      });
    }
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

    // Optimistic lock FIRST — claim the transition before moving any money.
    // Only one concurrent path can flip status = old → new; the loser matches
    // no row and stops here, so the money op below runs at most once and never
    // races a second capture. Because everything is in one tx, a later failure
    // (e.g. the PSP call throwing) rolls the claimed transition back too.
    const [claimed] = await tx
      .update(schema.orders)
      .set({ status: to })
      .where(
        and(
          eq(schema.orders.id, order.id),
          eq(schema.orders.status, order.status),
        ),
      )
      .returning();
    if (!claimed) {
      throw new OrderError('order changed concurrently', 'conflict');
    }

    let updated = claimed;
    if (money && order.paymentRef) {
      const intent = await this.payments[money](order.paymentRef);
      await tx.insert(schema.payments).values({
        tenantId,
        orderId: order.id,
        action: money,
        amountMinor: order.totalMinor,
        provider: this.payments.name,
        providerRef: order.paymentRef,
        status: intent.status,
      });
      const [repriced] = await tx
        .update(schema.orders)
        .set({ paymentStatus: intent.status })
        .where(eq(schema.orders.id, order.id))
        .returning();
      updated = repriced ?? { ...claimed, paymentStatus: intent.status };
    }
    await tx.insert(schema.orderEvents).values({
      tenantId,
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
    });

    // Loyalty: award 1 point per SAR when an order completes.
    if (to === 'COMPLETE' && order.dinerPhone) {
      const points = Math.floor(order.totalMinor / 100);
      if (points > 0) {
        await tx
          .insert(schema.loyaltyAccounts)
          .values({ tenantId, dinerPhone: order.dinerPhone, points })
          .onConflictDoUpdate({
            target: [
              schema.loyaltyAccounts.tenantId,
              schema.loyaltyAccounts.dinerPhone,
            ],
            set: { points: sql`${schema.loyaltyAccounts.points} + ${points}` },
          });
        await tx.insert(schema.loyaltyLedger).values({
          tenantId,
          dinerPhone: order.dinerPhone,
          orderId: order.id,
          delta: points,
          reason: 'order_complete',
        });
      }
    }
    return updated;
  }
}
