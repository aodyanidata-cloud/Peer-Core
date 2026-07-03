import { Injectable } from '@nestjs/common';
import { and, eq, ilike } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

/**
 * DriverDirectoryService — a discovery directory of drivers a restaurant can
 * call and arrange with off-platform (BRD §6.7c). The platform shows the listing
 * and contact only; it is never party to the arrangement.
 */
@Injectable()
export class DriverDirectoryService {
  constructor(private readonly tenancy: TenancyService) {}

  add(
    tenantId: string,
    input: {
      name: string;
      phone: string;
      areas?: string;
      vehicleType?: string;
      rateNote?: string;
    },
  ) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.driverListings)
        .values({
          tenantId,
          name: input.name,
          phone: input.phone,
          areas: input.areas ?? null,
          vehicleType: input.vehicleType ?? null,
          rateNote: input.rateNote ?? null,
        })
        .returning();
      return row;
    });
  }

  list(tenantId: string, area?: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      area
        ? tx
            .select()
            .from(schema.driverListings)
            .where(ilike(schema.driverListings.areas, `%${area}%`))
        : tx.select().from(schema.driverListings),
    );
  }

  verify(tenantId: string, id: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx
        .update(schema.driverListings)
        .set({ verified: true })
        .where(and(eq(schema.driverListings.id, id))),
    );
  }
}
