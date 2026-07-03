import { Injectable } from '@nestjs/common';
import { and, eq, ilike } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import { ConversationService } from '../../modules/agent/conversation.service';

export interface MenuMatch {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
}

export interface ItemFacts {
  id: string;
  name: string;
  priceMinor: number; // ALWAYS from the structured catalog
  currency: string;
  allergens: string[] | null; // declared allergens, or null if not declared
  adviseConfirmAllergens: boolean; // true when allergens are not declared — never guess
  available: boolean;
}

/**
 * DinerAgentService — diner discovery & ordering agent (R1.4, guardrail-critical).
 *
 * Guardrails enforced STRUCTURALLY (not by trusting the model):
 *  - Never invents items: search returns only this tenant's real catalog rows.
 *  - Never invents prices: price always comes from the catalog, never the message
 *    or the model — a diner-stated price is ignored (price-injection defense).
 *  - Allergen answers come only from declared data; if undeclared, it advises
 *    confirming with the restaurant instead of guessing.
 *  - Sold-out ("86") and hidden items are excluded from discovery.
 *  - Everything is tenant-scoped by RLS: an agent only ever sees its own menu.
 */
@Injectable()
export class DinerAgentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly conversation: ConversationService,
  ) {}

  /** Structured menu search — only AVAILABLE items of THIS tenant. */
  async searchMenu(
    tenantId: string,
    query: string,
    k = 5,
  ): Promise<MenuMatch[]> {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.catalogItems.id,
          name: schema.catalogItems.name,
          priceMinor: schema.catalogItems.priceMinor,
          currency: schema.catalogItems.currency,
        })
        .from(schema.catalogItems)
        .where(
          and(
            eq(schema.catalogItems.status, 'available'),
            ilike(schema.catalogItems.name, `%${query}%`),
          ),
        )
        .limit(k);
      return rows;
    });
  }

  /**
   * Authoritative facts for one item. Price and availability are read from the
   * catalog; `message` is deliberately NOT a parameter to any price computation.
   */
  async itemFacts(tenantId: string, itemId: string): Promise<ItemFacts | null> {
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [item] = await tx
        .select()
        .from(schema.catalogItems)
        .where(eq(schema.catalogItems.id, itemId))
        .limit(1);
      if (!item) return null;
      const attrs = (item.attributes ?? {}) as { allergens?: string[] | null };
      const allergens =
        Array.isArray(attrs.allergens) && attrs.allergens.length > 0
          ? attrs.allergens
          : null;
      return {
        id: item.id,
        name: item.name,
        priceMinor: item.priceMinor,
        currency: item.currency,
        allergens,
        adviseConfirmAllergens: allergens === null,
        available: item.status === 'available',
      };
    });
  }

  /**
   * Conversational answer. Uses RAG for phrasing only; any price/availability a
   * caller surfaces to the diner must come from itemFacts/searchMenu, not the
   * generated text.
   */
  ask(tenantId: string, message: string) {
    return this.conversation.reply(tenantId, message);
  }
}
