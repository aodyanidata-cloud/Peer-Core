import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import { CatalogService } from '../../modules/catalog/catalog.service';

export interface ModifierOption {
  name: string;
  priceDeltaMinor: number; // integer minor units; may be 0 (e.g. "no onions")
}
export interface ModifierGroup {
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: ModifierOption[];
}

export interface NewMenuItem {
  name: string;
  description?: string;
  categoryId?: string;
  priceMinor: number;
  currency?: string;
  allergens?: string[];
  tags?: string[];
  modifierGroups?: ModifierGroup[];
}

/** Validate modifier groups: min/max sane, options integer deltas, required consistency. */
export function validateModifierGroups(groups: ModifierGroup[]): void {
  for (const g of groups) {
    if (!g.name) throw new Error('modifier group needs a name');
    if (!Number.isInteger(g.minSelect) || !Number.isInteger(g.maxSelect)) {
      throw new Error(`modifier group "${g.name}": min/max must be integers`);
    }
    if (g.minSelect < 0 || g.maxSelect < g.minSelect) {
      throw new Error(`modifier group "${g.name}": require 0 <= min <= max`);
    }
    if (g.maxSelect > g.options.length) {
      throw new Error(`modifier group "${g.name}": max exceeds option count`);
    }
    if (g.required && g.minSelect < 1) {
      throw new Error(`modifier group "${g.name}": required needs min >= 1`);
    }
    for (const o of g.options) {
      if (!Number.isInteger(o.priceDeltaMinor)) {
        throw new Error(`modifier "${o.name}": priceDeltaMinor must be an integer`);
      }
    }
  }
}

/**
 * MenuService — restaurant menu on top of the generic catalog (R1.2).
 * Modifier groups, allergens, and tags live in the catalog item's JSONB
 * attributes (the engine stays generic). Handles "86" (sold-out) and per-branch
 * availability. Ordering/cart math is R2 — not here.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly catalog: CatalogService,
  ) {}

  createItem(tenantId: string, input: NewMenuItem) {
    if (input.modifierGroups) validateModifierGroups(input.modifierGroups);
    return this.catalog.createItem(tenantId, {
      name: input.name,
      priceMinor: input.priceMinor,
      attributes: {
        modifierGroups: input.modifierGroups ?? [],
        allergens: input.allergens ?? null,
        tags: input.tags ?? [],
      },
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    });
  }

  /** "86" an item (sold out) or bring it back, across all branches. */
  setSoldOut(tenantId: string, itemId: string, soldOut: boolean) {
    return this.catalog.setItemStatus(
      tenantId,
      itemId,
      soldOut ? 'sold_out' : 'available',
    );
  }

  /** Per-branch availability override. */
  setBranchAvailability(
    tenantId: string,
    itemId: string,
    branchId: string,
    available: boolean,
  ) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      await tx
        .insert(schema.menuAvailability)
        .values({ tenantId, itemId, branchId, available })
        .onConflictDoUpdate({
          target: [schema.menuAvailability.itemId, schema.menuAvailability.branchId],
          set: { available },
        });
    });
  }

  /** Is the item orderable at a branch: item not 86'd AND no branch override to false. */
  async isAvailableAtBranch(
    tenantId: string,
    itemId: string,
    branchId: string,
  ): Promise<boolean> {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [item] = await tx
        .select({ status: schema.catalogItems.status })
        .from(schema.catalogItems)
        .where(eq(schema.catalogItems.id, itemId))
        .limit(1);
      if (!item || item.status !== 'available') return false;
      const [override] = await tx
        .select({ available: schema.menuAvailability.available })
        .from(schema.menuAvailability)
        .where(
          and(
            eq(schema.menuAvailability.itemId, itemId),
            eq(schema.menuAvailability.branchId, branchId),
          ),
        )
        .limit(1);
      return override ? override.available : true;
    });
  }
}
