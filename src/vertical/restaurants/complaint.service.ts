import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/**
 * ComplaintService — capture diner complaints and route them to staff (R1.9).
 * Tenant-scoped; a captured complaint starts 'open' for staff to work.
 */
@Injectable()
export class ComplaintService {
  constructor(private readonly tenancy: TenancyService) {}

  capture(
    tenantId: string,
    input: { subject: string; body: string; branchId?: string; dinerPhone?: string },
  ) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.complaints)
        .values({
          tenantId,
          subject: input.subject,
          body: input.body,
          branchId: input.branchId ?? null,
          dinerPhone: input.dinerPhone ?? null,
        })
        .returning();
      return row;
    });
  }

  listOpen(tenantId: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx
        .select()
        .from(schema.complaints)
        .where(eq(schema.complaints.status, 'open')),
    );
  }

  setStatus(tenantId: string, complaintId: string, status: ComplaintStatus) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.complaints)
        .set({ status })
        .where(eq(schema.complaints.id, complaintId))
        .returning();
      return row;
    });
  }
}
