import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

/**
 * LoyaltyService — read side of the merchant's own points program (R2 §11A).
 * Points are awarded by OrderService when an order completes (1 point per SAR).
 */
@Injectable()
export class LoyaltyService {
  constructor(private readonly tenancy: TenancyService) {}

  async balance(tenantId: string, dinerPhone: string): Promise<number> {
    const [acct] = await this.tenancy.runAs(tenantId, (tx) =>
      tx
        .select({ points: schema.loyaltyAccounts.points })
        .from(schema.loyaltyAccounts)
        .where(eq(schema.loyaltyAccounts.dinerPhone, dinerPhone))
        .limit(1),
    );
    return acct?.points ?? 0;
  }

  history(tenantId: string, dinerPhone: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx
        .select()
        .from(schema.loyaltyLedger)
        .where(eq(schema.loyaltyLedger.dinerPhone, dinerPhone)),
    );
  }
}
