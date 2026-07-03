import { Injectable } from '@nestjs/common';
import * as schema from '../../db/schema';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import { KbService } from '../../modules/agent/kb.service';

/**
 * MenuSyncService — indexes menu items into the tenant KB (R1.3) so the diner
 * agent can discover them in natural language. The KB is for phrasing/retrieval;
 * authoritative price and availability always come from the structured catalog
 * (see DinerAgentService), never from the retrieved text.
 */
@Injectable()
export class MenuSyncService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly kb: KbService,
  ) {}

  async indexItem(
    tenantId: string,
    item: {
      name: string;
      description?: string | null;
      priceMinor: number;
      currency?: string;
      allergens?: string[] | null;
    },
  ): Promise<{ id: string }> {
    const parts = [
      item.description ?? '',
      item.allergens?.length ? `Allergens: ${item.allergens.join(', ')}.` : '',
    ].filter(Boolean);
    return this.kb.addDocument(tenantId, {
      title: item.name,
      content: parts.join(' ') || item.name,
      source: 'menu',
    });
  }

  /** Re-index every catalog item for a tenant (e.g. after a bulk menu import). */
  async syncAll(tenantId: string): Promise<number> {
    const items = await this.tenancy.runAs(tenantId, (tx) =>
      tx.select().from(schema.catalogItems),
    );
    for (const it of items) {
      const attrs = (it.attributes ?? {}) as { allergens?: string[] | null };
      await this.indexItem(tenantId, {
        name: it.name,
        description: it.description,
        priceMinor: it.priceMinor,
        currency: it.currency,
        allergens: attrs.allergens ?? null,
      });
    }
    return items.length;
  }
}
