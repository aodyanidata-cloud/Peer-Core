import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import { ValidationError } from '../../common/validation-error';

export type DeliveryStatus = 'assigned' | 'picked_up' | 'delivered' | 'failed';

/**
 * DeliveryService — lightweight, restaurant-owned delivery + driver-earnings
 * ledger (R2 / BRD §6.7). The platform TRACKS and DISPLAYS what the restaurant
 * owes the driver; it never pays the driver or moves that money. Settlement is
 * the restaurant's own off-platform arrangement, recorded here for transparency.
 */
@Injectable()
export class DeliveryService {
  constructor(private readonly tenancy: TenancyService) {}

  assign(
    tenantId: string,
    orderId: string,
    driver: { name: string; phone: string },
    earningMinor: number,
  ) {
    if (!Number.isInteger(earningMinor) || earningMinor < 0) {
      throw new ValidationError('earning must be a non-negative integer (minor units)');
    }
    // One delivery + one earning per order — a second assign REASSIGNS (replaces
    // the driver and earning) rather than double-counting.
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [delivery] = await tx
        .insert(schema.deliveries)
        .values({
          tenantId,
          orderId,
          driverName: driver.name,
          driverPhone: driver.phone,
        })
        .onConflictDoUpdate({
          target: schema.deliveries.orderId,
          set: {
            driverName: driver.name,
            driverPhone: driver.phone,
            status: 'assigned',
          },
        })
        .returning();
      await tx
        .insert(schema.driverEarnings)
        .values({
          tenantId,
          driverPhone: driver.phone,
          orderId,
          amountMinor: earningMinor,
        })
        .onConflictDoUpdate({
          target: schema.driverEarnings.orderId,
          set: { driverPhone: driver.phone, amountMinor: earningMinor },
          // Never rewrite a SETTLED earning — that row is closed history.
          // A reassign only replaces the still-open (unsettled) earning.
          setWhere: eq(schema.driverEarnings.settled, false),
        });
      return delivery;
    });
  }

  setStatus(tenantId: string, deliveryId: string, status: DeliveryStatus) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.deliveries)
        .set({ status })
        .where(eq(schema.deliveries.id, deliveryId))
        .returning();
      return row;
    });
  }

  /** Running tally the driver is owed for the current (unsettled) period. */
  async owed(tenantId: string, driverPhone: string): Promise<number> {
    const rows = await this.tenancy.runAs(tenantId, (tx) =>
      tx
        .select({ amountMinor: schema.driverEarnings.amountMinor })
        .from(schema.driverEarnings)
        .where(
          and(
            eq(schema.driverEarnings.driverPhone, driverPhone),
            eq(schema.driverEarnings.settled, false),
          ),
        ),
    );
    return rows.reduce((sum, r) => sum + r.amountMinor, 0);
  }

  /** Restaurant paid the driver (off-platform) → mark the period settled. */
  settle(tenantId: string, driverPhone: string, at: Date) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx
        .update(schema.driverEarnings)
        .set({ settled: true, settledAt: at })
        .where(
          and(
            eq(schema.driverEarnings.driverPhone, driverPhone),
            eq(schema.driverEarnings.settled, false),
          ),
        ),
    );
  }
}
