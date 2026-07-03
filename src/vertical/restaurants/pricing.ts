/**
 * Pricing — server-side money math (R2 🔴). Pure and integer-only (minor units),
 * never floats. VAT is KSA 15%. All amounts here originate from the STRUCTURED
 * catalog; a client- or model-supplied price never reaches this function.
 */
export const VAT_RATE_PERCENT = 15;

export interface PricedModifier {
  name: string;
  priceDeltaMinor: number;
}
export interface PriceLineInput {
  unitPriceMinor: number; // catalog base price
  quantity: number;
  modifiers: PricedModifier[];
}
export interface PricedLine {
  effectiveUnitMinor: number;
  lineTotalMinor: number;
}
export interface OrderTotals {
  subtotalMinor: number;
  discountMinor: number;
  vatMinor: number;
  totalMinor: number;
  lines: PricedLine[];
}

/**
 * VAT applies to the DISCOUNTED base: total = (subtotal − discount) + VAT + delivery.
 * The discount is clamped so the taxable base never goes negative.
 */
export function computeTotals(
  lines: PriceLineInput[],
  deliveryFeeMinor = 0,
  discountMinor = 0,
): OrderTotals {
  const priced = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw new Error('quantity must be a positive integer');
    }
    const effectiveUnitMinor =
      l.unitPriceMinor +
      l.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);
    if (effectiveUnitMinor < 0) {
      throw new Error('effective unit price cannot be negative');
    }
    return {
      effectiveUnitMinor,
      lineTotalMinor: effectiveUnitMinor * l.quantity,
    };
  });
  const subtotalMinor = priced.reduce((s, l) => s + l.lineTotalMinor, 0);
  const discount = Math.max(0, Math.min(discountMinor, subtotalMinor));
  const taxableBase = subtotalMinor - discount;
  const vatMinor = Math.round((taxableBase * VAT_RATE_PERCENT) / 100);
  return {
    subtotalMinor,
    discountMinor: discount,
    vatMinor,
    totalMinor: taxableBase + vatMinor + deliveryFeeMinor,
    lines: priced,
  };
}
