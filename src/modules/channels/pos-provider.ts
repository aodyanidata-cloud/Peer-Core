/**
 * PosProvider contract — present from DAY ONE so the R3 Foodics integration is a
 * clean adapter, not a refactor (per the BRD's PosProvider-compatibility rule).
 *
 * The catalog already carries `external_ref` + `source` (B3) to map onto POS ids.
 * No adapter is wired yet; this fixes the shape everything else builds against.
 */

export interface PosMenuItem {
  externalRef: string; // the POS's id for this item -> catalog_items.external_ref
  name: string;
  priceMinor: number; // integer minor units
  categoryRef?: string;
  available?: boolean;
}

export interface PosOrderLine {
  externalRef: string;
  quantity: number;
}

export interface PosProvider {
  readonly name: string;
  /** Pull the merchant's menu from the POS for sync into the catalog. */
  fetchMenu(config: Record<string, unknown>): Promise<PosMenuItem[]>;
  /** Push an accepted order to the POS. Returns the POS order reference. */
  pushOrder(
    config: Record<string, unknown>,
    lines: PosOrderLine[],
  ): Promise<{ externalRef: string }>;
}
