import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

export type WeeklyHours = Record<string, [string, string][]>;

export interface BranchInfo {
  name: string;
  address: string | null;
  phone: string | null;
  hours: WeeklyHours;
  lat: number | null;
  lng: number | null;
}

/**
 * FaqService — deterministic info & FAQ (R1.5). Hours, location, and phone are
 * answered straight from structured branch fields — never generated, so they are
 * always correct. (Deterministic-before-generative, per the BRD.)
 */
@Injectable()
export class FaqService {
  constructor(private readonly tenancy: TenancyService) {}

  async branchInfo(
    tenantId: string,
    branchId: string,
  ): Promise<BranchInfo | null> {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [b] = await tx
        .select()
        .from(schema.branches)
        .where(eq(schema.branches.id, branchId))
        .limit(1);
      if (!b) return null;
      return {
        name: b.name,
        address: b.address,
        phone: b.phone,
        hours: (b.hours ?? {}) as WeeklyHours,
        lat: b.lat,
        lng: b.lng,
      };
    });
  }

  /** Today's opening windows for a branch, by lowercase weekday (e.g. 'mon'). */
  async hoursForDay(
    tenantId: string,
    branchId: string,
    weekday: string,
  ): Promise<[string, string][]> {
    const info = await this.branchInfo(tenantId, branchId);
    return info?.hours[weekday.toLowerCase()] ?? [];
  }
}
