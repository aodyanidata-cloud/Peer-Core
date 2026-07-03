import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';

export class ReservationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'no_table'
      | 'over_capacity'
      | 'slot_taken'
      | 'not_found'
      | 'bad_status',
  ) {
    super(message);
    this.name = 'ReservationError';
  }
}

const TERMINAL_STATUS = ['seated', 'completed', 'no_show', 'cancelled'] as const;
type TerminalStatus = (typeof TERMINAL_STATUS)[number];

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

  // ── Lifecycle (R1.7) ────────────────────────────────────────────────────────

  /** Cancel a reservation — frees its slot (excluded from the overlap constraint). */
  cancel(tenantId: string, reservationId: string) {
    return this.setStatus(tenantId, reservationId, 'cancelled');
  }

  /** Transition to seated / completed / no_show / cancelled. */
  async setStatus(
    tenantId: string,
    reservationId: string,
    status: TerminalStatus,
  ) {
    if (!TERMINAL_STATUS.includes(status)) {
      throw new ReservationError(`invalid status ${status}`, 'bad_status');
    }
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.reservations)
        .set({ status })
        .where(eq(schema.reservations.id, reservationId))
        .returning();
      if (!row) throw new ReservationError('no such reservation', 'not_found');
      return row;
    });
  }

  /** Move a booking to a new time/party; the exclusion constraint re-checks the new window. */
  async modify(
    tenantId: string,
    reservationId: string,
    change: { startsAt: Date; durationMin: number; partySize?: number },
  ) {
    const endsAt = new Date(
      change.startsAt.getTime() + change.durationMin * 60_000,
    );
    return this.tenancy.runAs(tenantId, async (tx) => {
      try {
        const [row] = await tx
          .update(schema.reservations)
          .set({
            startsAt: change.startsAt,
            endsAt,
            ...(change.partySize !== undefined
              ? { partySize: change.partySize }
              : {}),
          })
          .where(eq(schema.reservations.id, reservationId))
          .returning();
        if (!row) throw new ReservationError('no such reservation', 'not_found');
        return row;
      } catch (e) {
        if ((e as { code?: string }).code === EXCLUSION_VIOLATION) {
          throw new ReservationError('new time is already booked', 'slot_taken');
        }
        throw e;
      }
    });
  }

  // ── Waitlist (R1.7) ─────────────────────────────────────────────────────────

  addToWaitlist(
    tenantId: string,
    input: Omit<BookInput, 'tableId'>,
  ) {
    const endsAt = new Date(
      input.startsAt.getTime() + input.durationMin * 60_000,
    );
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.reservations)
        .values({
          tenantId,
          branchId: input.branchId,
          tableId: null,
          partySize: input.partySize,
          startsAt: input.startsAt,
          endsAt,
          status: 'waitlisted',
          dinerName: input.dinerName ?? null,
          dinerPhone: input.dinerPhone ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    });
  }

  /** Promote a waitlisted entry onto a table; the constraint guards the slot. */
  async promoteFromWaitlist(
    tenantId: string,
    reservationId: string,
    tableId: string,
  ) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      try {
        const [row] = await tx
          .update(schema.reservations)
          .set({ tableId, status: 'confirmed' })
          .where(eq(schema.reservations.id, reservationId))
          .returning();
        if (!row) throw new ReservationError('no such reservation', 'not_found');
        return row;
      } catch (e) {
        if ((e as { code?: string }).code === EXCLUSION_VIOLATION) {
          throw new ReservationError('table already booked', 'slot_taken');
        }
        throw e;
      }
    });
  }

  // ── Staff book view (R1.8) ──────────────────────────────────────────────────

  listReservations(tenantId: string, branchId: string) {
    return this.tenancy.runAs(tenantId, (tx) =>
      tx
        .select()
        .from(schema.reservations)
        .where(eq(schema.reservations.branchId, branchId)),
    );
  }
}
