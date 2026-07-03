import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

export class ReservationError extends Error {
  constructor(
    message: string,
    readonly code: 'no_table' | 'over_capacity' | 'slot_taken',
  ) {
    super(message);
    this.name = 'ReservationError';
  }
}

export interface BookInput {
  branchId: string;
  tableId: string;
  partySize: number;
  startsAt: Date;
  durationMin: number;
  dinerName?: string;
  dinerPhone?: string;
  notes?: string;
}

const EXCLUSION_VIOLATION = '23P01';

function rangesOverlap(aS: Date, aE: Date, bS: Date, bE: Date): boolean {
  return aS < bE && bS < aE;
}

/**
 * ReservationService — table reservations (R1.6, concurrency-critical).
 *
 * Double-booking prevention is ATOMIC and lives in the database: the exclusion
 * constraint ex_reservations_no_overlap rejects a second overlapping active
 * reservation for the same table even when two requests race. `book` surfaces
 * that as a clean `slot_taken` error. `findAvailableTable` is a best-effort
 * suggestion; the constraint — not this query — is the guarantee.
 */
@Injectable()
export class ReservationService {
  constructor(private readonly tenancy: TenancyService) {}

  async book(tenantId: string, input: BookInput) {
    const endsAt = new Date(
      input.startsAt.getTime() + input.durationMin * 60_000,
    );
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [table] = await tx
        .select({ capacity: schema.restaurantTables.capacity })
        .from(schema.restaurantTables)
        .where(eq(schema.restaurantTables.id, input.tableId))
        .limit(1);
      if (!table) throw new ReservationError('no such table', 'no_table');
      if (input.partySize > table.capacity) {
        throw new ReservationError(
          'party exceeds table capacity',
          'over_capacity',
        );
      }
      try {
        const [row] = await tx
          .insert(schema.reservations)
          .values({
            tenantId,
            branchId: input.branchId,
            tableId: input.tableId,
            partySize: input.partySize,
            startsAt: input.startsAt,
            endsAt,
            status: 'confirmed',
            dinerName: input.dinerName ?? null,
            dinerPhone: input.dinerPhone ?? null,
            notes: input.notes ?? null,
          })
          .returning();
        return row;
      } catch (e) {
        if ((e as { code?: string }).code === EXCLUSION_VIOLATION) {
          throw new ReservationError(
            'that table is already booked for an overlapping time',
            'slot_taken',
          );
        }
        throw e;
      }
    });
  }

  /** Best-effort: the smallest-capacity table in the branch that fits and is free. */
  async findAvailableTable(
    tenantId: string,
    branchId: string,
    partySize: number,
    startsAt: Date,
    durationMin: number,
  ): Promise<{ id: string; capacity: number } | null> {
    const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
    return this.tenancy.runAs(tenantId, async (tx) => {
      const tables = await tx
        .select({
          id: schema.restaurantTables.id,
          capacity: schema.restaurantTables.capacity,
        })
        .from(schema.restaurantTables)
        .where(
          and(
            eq(schema.restaurantTables.branchId, branchId),
            gte(schema.restaurantTables.capacity, partySize),
          ),
        );
      const active = await tx
        .select({
          tableId: schema.reservations.tableId,
          startsAt: schema.reservations.startsAt,
          endsAt: schema.reservations.endsAt,
        })
        .from(schema.reservations)
        .where(
          and(
            eq(schema.reservations.branchId, branchId),
            inArray(schema.reservations.status, ['confirmed', 'seated']),
          ),
        );

      const sorted = [...tables].sort((a, b) => a.capacity - b.capacity);
      for (const t of sorted) {
        const clash = active.some(
          (r) =>
            r.tableId === t.id &&
            rangesOverlap(r.startsAt, r.endsAt, startsAt, endsAt),
        );
        if (!clash) return t;
      }
      return null;
    });
  }
}
